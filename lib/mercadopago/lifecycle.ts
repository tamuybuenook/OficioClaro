// Ciclo administrativo de suscripciones con renovaciones activas en Mercado Pago (suspender, cancelar, eliminar).
// Principios:
//  - SEGUIMIENTO PRIMERO: el estado local y la marca 'cancelling' de las autorizaciones abiertas se aplican en una sola
//    transacción de base (mp_begin_wind_down). Si el proceso muere después, el cron sabe qué cancelar.
//  - Una autorización solo se da por cancelada si Mercado Pago lo CONFIRMA (cancelPreapproval). Rechazo, timeout o
//    resultado incierto => sigue 'cancelling', con incidente y reintento; nunca 'cancelled'.
//  - Eliminar un usuario es irreversible y borra el ledger por cascada: solo se hace con TODAS las autorizaciones
//    confirmadas como canceladas y sin cobros retenidos pendientes. Si no, no se borra nada.
import { MpApiError, type MpClient } from './client'
import type { MpStore, PreapprovalRow } from './store'
import { cancelPreapproval } from './preapprovals'
import { processMpEvent } from './process-event'

type Deps = { mp: MpClient; store: MpStore }

/** Cliente de reemplazo cuando Mercado Pago no está configurado: toda llamada falla como "no se pudo contactar" (resultado incierto). */
export const unavailableMp: MpClient = {
  request: async () => { throw new MpApiError(0, 'Mercado Pago no está configurado en este entorno') },
}

export type RowOutcome = { id: string; confirmed: boolean; detail?: string }
export type WindDownResult = {
  previousStatus: string
  /** true = no queda ninguna autorización viva o sin confirmar para esta suscripción. */
  allConfirmed: boolean
  rows: RowOutcome[]
}

async function cancelRows(d: Deps, rows: PreapprovalRow[]): Promise<RowOutcome[]> {
  const out: RowOutcome[] = []
  for (const row of rows) {
    try {
      const r = await cancelPreapproval(d, row)
      out.push({ id: row.id, confirmed: r.ok, detail: r.detail })
    } catch (e) {
      // Error inesperado (p.ej. la base): la fila ya está en 'cancelling' por la transacción previa; el cron la retoma.
      out.push({ id: row.id, confirmed: false, detail: e instanceof Error ? e.message : 'error desconocido' })
    }
  }
  return out
}

/**
 * Suspende o cancela una suscripción y cancela (y confirma) sus renovaciones en Mercado Pago.
 * El estado local queda aplicado aunque Mercado Pago no confirme (quitar el acceso no depende de un tercero);
 * en ese caso allConfirmed=false y las filas siguen en 'cancelling' hasta que el cron o un reintento las confirme.
 */
export async function windDownSubscription(
  d: Deps,
  a: { subscriptionId: string; status: 'suspended' | 'cancelled'; planId: string | null; actorId: string | null },
): Promise<WindDownResult> {
  const begun = await d.store.beginWindDown(a) // atómico: estado + seguimiento
  const open = await d.store.listOpenPreapprovals(a.subscriptionId)
  const rows = await cancelRows(d, open)
  return { previousStatus: begun.previousStatus, allConfirmed: rows.every((r) => r.confirmed), rows }
}

export type DeletionCheck =
  | { ok: true; cancelledPreapprovals: string[] }
  | { ok: false; reason: 'pending_cancellation' | 'held_payments' | 'pending_payments' | 'new_authorization'; detail: string }

/** Libera la retención de eliminación (si el borrado se aborta o falla). Nunca lanza: la retención además vence sola. */
export async function abortUserDeletion(d: Deps, userId: string): Promise<void> {
  try { await d.store.endUserDeletionHold(userId) } catch { /* vence sola a los 30 min */ }
}

/**
 * Prepara la eliminación de un usuario. Orden:
 *  1. Cobros retenidos sin resolver => no se continúa (sin tocar nada).
 *  2. RETENCIÓN (RPC atómico): desde ese momento la base rechaza abrir autorizaciones nuevas para esa cuenta y las abiertas
 *     quedan en seguimiento ('cancelling').
 *  3. Se cancelan y CONFIRMAN en MP. Si alguna no se confirma, se libera la retención y no se borra nada.
 *  4. Verificación final (ya sin posibilidad de altas nuevas) y auditoría.
 * ok=true => el llamador puede borrar; si el borrado falla debe llamar a abortUserDeletion. La base además impide borrar una
 * suscripción con una autorización abierta (trigger mp_guard_subscription_delete), aunque este código fallara.
 */
/**
 * Concilia los pagos pendientes de la cuenta ANTES de borrarla (con la retención ya vigente: no pueden aparecer intenciones nuevas).
 * Devuelve null si no queda nada por conciliar; si no, el detalle de lo que bloquea. Nunca da un pago por fallido por un timeout.
 */
async function settlePayments(d: Deps, userId: string): Promise<string | null> {
  const pending = await d.store.listPendingPaymentsOfUser(userId)
  for (const p of pending) {
    if (p.provider !== 'mercadopago' || p.status !== 'pending') continue
    try {
      const res = await d.mp.request<{ results?: { id: number | string }[] }>(
        'GET', `/v1/payments/search?external_reference=${encodeURIComponent(p.id)}&sort=date_created&criteria=desc&limit=10`)
      // Mismo camino (y mismas validaciones) que el webhook; es idempotente.
      for (const r of res.results ?? []) await processMpEvent(d, { topic: 'payment', dataId: String(r.id) })
    } catch {
      return 'No pudimos consultar en Mercado Pago el estado de un pago pendiente. No se eliminó nada; volvé a intentarlo en unos minutos.'
    }
  }
  for (const p of await d.store.listPendingPaymentsOfUser(userId)) {
    // Solo una intención SIN pago asociado y vencida se puede cerrar (la base lo verifica: mp_expire_intent).
    if (p.provider === 'mercadopago' && p.status === 'pending' && !p.external_id && !p.applied_at) {
      const r = await d.store.expireIntent(p.id)
      if (r.expired) continue
    }
    return 'El usuario tiene pagos pendientes, en proceso o retenidos que requieren conciliación. No se eliminó nada: se eliminará cuando se concilien (o venza la intención de pago).'
  }
  return null
}

export async function prepareUserDeletion(d: Deps, a: { userId: string; actorId: string | null }): Promise<DeletionCheck> {
  // Dinero cobrado y retenido sin resolver: borrar la cuenta borraría su rastro (pagos por cascada).
  if ((await d.store.countHeldPayments(a.userId)) > 0) {
    return { ok: false, reason: 'held_payments', detail: 'El usuario tiene cobros de Mercado Pago retenidos sin resolver o con un reembolso pendiente. Resolvelos (aplicar o completar el reembolso) antes de eliminarlo.' }
  }

  await d.store.beginUserDeletion(a) // si falla, nada cambió: el error se propaga y no se borra nada
  try {
    const blocked = await settlePayments(d, a.userId)
    if (blocked) {
      await abortUserDeletion(d, a.userId)
      return { ok: false, reason: 'pending_payments', detail: blocked }
    }
    const subs = await d.store.getSubscriptionsOfUser(a.userId)
    const cancelled: string[] = []
    for (const sub of subs) {
      const open = await d.store.listOpenPreapprovals(sub.id)
      const rows = await cancelRows(d, open)
      if (rows.some((r) => !r.confirmed)) {
        await abortUserDeletion(d, a.userId)
        return { ok: false, reason: 'pending_cancellation', detail: 'No pudimos confirmar en Mercado Pago la cancelación de la renovación automática. No se eliminó nada: quedó registrada y se reintentará; volvé a intentarlo en unos minutos.' }
      }
      for (const r of open) if (r.preapproval_id) cancelled.push(r.preapproval_id)
    }
    // Verificación final: con la retención vigente no pueden aparecer altas nuevas; si igual hay algo abierto, no se borra.
    for (const sub of subs) {
      if ((await d.store.listOpenPreapprovals(sub.id)).length > 0) {
        await abortUserDeletion(d, a.userId)
        return { ok: false, reason: 'new_authorization', detail: 'Quedó una autorización abierta mientras se procesaba. No se eliminó nada; volvé a intentarlo.' }
      }
    }
    // Última verificación de pagos (la retención impide intenciones nuevas; un webhook pudo dejar un cobro retenido).
    if ((await d.store.listPendingPaymentsOfUser(a.userId)).length > 0) {
      await abortUserDeletion(d, a.userId)
      return { ok: false, reason: 'pending_payments', detail: 'Apareció un pago que requiere conciliación mientras se procesaba. No se eliminó nada; volvé a intentarlo.' }
    }
    // Auditoría ANTES de borrar (el ledger se elimina por cascada con la suscripción).
    await d.store.logIncident('profiles', a.userId, 'admin_delete_user_renewals_cancelled', { preapproval_ids: cancelled, subscriptions: subs.map((s) => s.id) }, a.actorId)
    return { ok: true, cancelledPreapprovals: cancelled }
  } catch (e) {
    await abortUserDeletion(d, a.userId)
    throw e
  }
}

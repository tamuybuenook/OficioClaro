// Procesamiento de notificaciones de MP. La notificación NUNCA es fuente de verdad: solo dice
// "algo cambió en el recurso X"; el estado real se consulta a la API con el token privado.
// Errores transitorios se propagan (el webhook responde 5xx y MP reintenta); los de negocio se registran y se responde 200.
import { MpApiError, type MpClient } from './client'
import type { MpStore } from './store'
import { cancelPreapproval, resolveRowByMpId } from './preapprovals'

export type MpEvent = { topic: string | null; dataId: string }
// 'held': cobro aprobado que contradice el estado local (cuenta suspendida/cancelada): registrado y retenido para revisión, NO acreditado.
export type MpOutcome = { outcome: 'processed' | 'duplicate' | 'ignored' | 'rejected' | 'held'; detail?: string }
const LIVE_OR_PENDING = ['creating', 'pending', 'authorized', 'paused', 'cancelling']

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function getOrNull<T>(mp: MpClient, path: string): Promise<T | null> {
  try { return await mp.request<T>('GET', path) } catch (e) {
    if (e instanceof MpApiError && e.status === 404) return null
    throw e
  }
}

export async function processMpEvent(deps: { mp: MpClient; store: MpStore }, event: MpEvent): Promise<MpOutcome> {
  const { mp, store } = deps
  const id = encodeURIComponent(event.dataId)
  try {
    switch (event.topic) {
      case 'payment': {
        const pay = await getOrNull<any>(mp, `/v1/payments/${id}`)
        if (!pay) return { outcome: 'ignored', detail: 'pago inexistente en MP (¿notificación de prueba?)' }
        const ref = String(pay.external_reference ?? '')
        if (!UUID.test(ref)) return { outcome: 'ignored', detail: 'sin external_reference propio (renovaciones: topic subscription_authorized_payment)' }
        const intent = await store.getIntent(ref)
        if (!intent) {
          // Un pago de MP con nuestra referencia pero sin registro local (cuenta eliminada o dato perdido): queda como incidencia
          // para conciliación manual, con lo necesario para identificarlo y reembolsarlo.
          // ¿Pertenecía a una cuenta eliminada? La instantánea de la eliminación permite atribuirlo (best-effort: nunca rompe el webhook).
          const deleted = (await store.traceDeletedPayment(String(pay.id)).catch(() => null)) ?? (await store.traceDeletedPayment(ref).catch(() => null))
          await store.logIncident('payments', ZERO_UUID, 'mp_incident_payment_without_local_record', {
            payment_id: String(pay.id), external_reference: ref, status: String(pay.status), amount: Number(pay.transaction_amount), currency: String(pay.currency_id),
            deleted_account: deleted,
          })
          return { outcome: 'ignored', detail: 'external_reference sin operación local' }
        }
        return await store.recordPayment({
          intentId: intent.id, subscriptionId: null, externalId: String(pay.id), mpStatus: String(pay.status),
          mpStatusDetail: pay.status_detail ?? null, amount: Number(pay.transaction_amount), currency: String(pay.currency_id),
        }) as MpOutcome
      }
      case 'subscription_authorized_payment': {
        const ap = await getOrNull<any>(mp, `/authorized_payments/${id}`)
        if (!ap?.preapproval_id) return { outcome: 'ignored', detail: 'cobro recurrente inexistente' }
        let row = await store.getPreapprovalByMpId(String(ap.preapproval_id))
        if (!row) {
          // La notificación puede llegar antes de que la base vincule el id: se resuelve por external_reference.
          const pre = await getOrNull<any>(mp, `/preapproval/${encodeURIComponent(String(ap.preapproval_id))}`)
          row = pre ? await resolveRowByMpId(deps, String(pre.id), pre.external_reference) : null
        }
        if (!row) {
          // Cobro de una autorización que no figura en el ledger (p.ej. usuario ya eliminado): no se puede atribuir ni acreditar.
          // Queda como incidencia para conciliación manual en el panel de Mercado Pago.
          if (ap.payment?.id) {
            const deleted = await store.traceDeletedPayment(String(ap.preapproval_id)).catch(() => null)
            await store.logIncident('mp_preapprovals', ZERO_UUID, 'mp_incident_unknown_preapproval_charge', { preapproval_id: String(ap.preapproval_id), authorized_payment_id: String(event.dataId), payment_id: String(ap.payment.id), deleted_account: deleted })
          }
          return { outcome: 'ignored', detail: 'preapproval desconocida' }
        }
        const payId = ap.payment?.id
        if (!payId) return { outcome: 'ignored', detail: 'cobro todavía sin pago asociado' }
        const pay = await getOrNull<any>(mp, `/v1/payments/${encodeURIComponent(String(payId))}`)
        if (!pay) return { outcome: 'ignored', detail: 'pago asociado inexistente' }
        // Autorización ya reemplazada/cancelada que igual cobró: el dinero se acredita (SQL) y se reintenta cancelar.
        if (['cancelling', 'cancelled', 'failed'].includes(row.status) && String(pay.status) === 'approved') await cancelPreapproval(deps, row).catch(() => undefined)
        const res = await store.recordPayment({
          intentId: null, subscriptionId: row.subscription_id, preapprovalId: String(ap.preapproval_id), externalId: String(pay.id), mpStatus: String(pay.status),
          mpStatusDetail: pay.status_detail ?? null, amount: Number(pay.transaction_amount), currency: String(pay.currency_id),
        }) as MpOutcome
        // Cobro retenido: la autorización que lo generó no debe seguir cobrando. Si no se confirma, queda en 'cancelling' (cron).
        if (res.outcome === 'held' && LIVE_OR_PENDING.includes(row.status)) await cancelPreapproval(deps, row).catch(() => undefined)
        return res
      }
      case 'subscription_preapproval': {
        const pre = await getOrNull<any>(mp, `/preapproval/${id}`)
        if (!pre) return { outcome: 'ignored', detail: 'preapproval inexistente' }
        const row = await resolveRowByMpId(deps, String(pre.id), pre.external_reference)
        if (!row) return { outcome: 'ignored', detail: 'preapproval desconocida' }
        // external_reference debe ser la fila del ledger (o, en altas anteriores a 0025, la suscripción).
        if (pre.external_reference !== row.id && pre.external_reference !== row.subscription_id) return { outcome: 'rejected', detail: 'external_reference no coincide' }
        const remote = String(pre.status)
        if (!['pending', 'authorized', 'paused', 'cancelled'].includes(remote)) return { outcome: 'ignored', detail: `estado ${remote}` }
        if (row.status === 'cancelled' || row.status === 'failed') {
          if (remote === 'cancelled') return { outcome: 'duplicate', detail: 'ya cancelada' }
          // Notificación tardía: una autorización que el sistema ya había cerrado figura viva en MP.
          await store.logIncident('mp_preapprovals', row.id, 'mp_incident_replaced_still_alive', { preapproval_id: String(pre.id), remote })
          const res = await cancelPreapproval(deps, row)
          return { outcome: 'rejected', detail: res.ok ? 'autorización reemplazada reactivada: se volvió a cancelar' : 'autorización reemplazada reactivada: cancelación NO confirmada (incidencia registrada)' }
        }
        if (row.status === 'cancelling') {
          if (remote === 'cancelled') { await store.markCancelled(row.id); return { outcome: 'processed', detail: 'cancelación confirmada' } }
          const res = await cancelPreapproval(deps, row) // sigue viva en MP: se reintenta
          return { outcome: 'rejected', detail: res.ok ? 'cancelación completada' : 'cancelación aún sin confirmar' }
        }
        await store.setPreapprovalStatus(row.id, remote as 'pending')
        return { outcome: 'processed', detail: `preapproval ${remote}` }
      }
      default:
        return { outcome: 'ignored', detail: `topic no manejado: ${event.topic}` }
    }
  } catch (e: any) {
    // Errores de negocio de record_mp_payment ("mp:...") => no reintentar. Todo lo demás => propagar.
    if (typeof e?.message === 'string' && e.message.includes('mp:')) return { outcome: 'rejected', detail: e.message.slice(e.message.indexOf('mp:')) }
    throw e
  }
}

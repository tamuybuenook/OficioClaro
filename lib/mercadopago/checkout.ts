// Inicio de cobro. El precio y el plan SIEMPRE se leen de la base: el cliente solo envía planId y modo.
import { periodMonths } from '@/lib/plan-period'
import { MpApiError, type MpClient } from './client'
import { RenewalsBlockedError, type MpStore, type PlanRow, type SubRow } from './store'
import { cancelPreapproval, resolveCreating } from './preapprovals'
import { logMpFailure } from './log'

export type CheckoutMode = 'one_time' | 'recurring'
export class CheckoutError extends Error {}

type Deps = { store: MpStore; mp: MpClient; appUrl: string; now?: () => number }
type Input = { userId: string; email: string | null; planId: string; mode: CheckoutMode; payerEmail?: string | null }

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

const REUSE_WINDOW_MS = 30 * 60 * 1000
const BLOCKED_MESSAGE = 'No podemos iniciar un pago en este momento porque tu cuenta está siendo procesada. Si es un error, escribinos.'

async function loadContext(d: Deps, i: Input): Promise<{ plan: PlanRow; sub: SubRow }> {
  if (!/^[0-9a-f-]{36}$/i.test(i.planId)) throw new CheckoutError('Plan inválido.')
  const plan = await d.store.getPlan(i.planId)
  if (!plan || !plan.is_active || !(plan.price > 0)) throw new CheckoutError('Ese plan no está disponible.')
  // Eliminación en curso (retención POR USUARIO: vale también si la cuenta no tiene suscripción). Falla rápido; la base lo
  // exige además con triggers (alta de suscripción, de intención de pago y de autorización).
  if (await d.store.isUserDeletionHeld(i.userId)) throw new CheckoutError(BLOCKED_MESSAGE)
  let sub = await d.store.getLatestSubscription(i.userId)
  if (!sub) {
    try { sub = await d.store.createLapsedSubscription(i.userId, plan.id) }
    catch (e) { if (e instanceof RenewalsBlockedError) throw new CheckoutError(BLOCKED_MESSAGE); throw e }
  }
  if (sub.status === 'suspended') throw new CheckoutError('Tu cuenta está suspendida. Escribinos para resolverlo.')
  return { plan, sub }
}

const backUrl = (appUrl: string, result: 'ok' | 'pending' | 'error') => `${appUrl}/?vista=suscripcion&mp=${result}`

export async function startCheckout(d: Deps, i: Input): Promise<{ url: string }> {
  const { plan, sub } = await loadContext(d, i)
  return i.mode === 'recurring' ? startRecurring(d, i, plan, sub) : startOneTime(d, i, plan, sub)
}

async function startOneTime(d: Deps, i: Input, plan: PlanRow, sub: SubRow): Promise<{ url: string }> {
  // Evita cobrar dos veces el mismo período (manual + automático).
  if (sub.mp_status === 'authorized' || sub.mp_status === 'paused')
    throw new CheckoutError('Tenés una renovación automática activa: el próximo cobro es automático. Cancelala si querés pagar manualmente.')
  const now = (d.now ?? Date.now)()
  const reusable = await d.store.findReusableIntent(sub.id, plan.id, plan.price, new Date(now - REUSE_WINDOW_MS).toISOString())
  if (reusable) return { url: reusable.checkout_url }

  let intent: { id: string }
  try { intent = await d.store.createIntent({ subscriptionId: sub.id, planId: plan.id, amount: plan.price }) }
  catch (e) { if (e instanceof RenewalsBlockedError) throw new CheckoutError(BLOCKED_MESSAGE); throw e }
  let created = false
  try {
    const https = d.appUrl.startsWith('https://')
    const pref = await d.mp.request<{ init_point?: string }>('POST', '/checkout/preferences', {
      items: [{ id: plan.id, title: `OficioClaro – Plan ${plan.name}`, quantity: 1, unit_price: plan.price, currency_id: 'ARS' }],
      external_reference: intent.id,
      ...(i.email ? { payer: { email: i.email } } : {}),
      back_urls: { success: backUrl(d.appUrl, 'ok'), pending: backUrl(d.appUrl, 'pending'), failure: backUrl(d.appUrl, 'error') },
      ...(https ? { auto_return: 'approved' } : {}),
      notification_url: `${d.appUrl}/api/mercadopago/webhook`,
      statement_descriptor: 'OFICIOCLARO',
      expires: true,
      expiration_date_to: new Date(now + 24 * 3600 * 1000).toISOString(),
    }, intent.id)
    created = true // desde acá la preferencia existe en MP: cualquier fallo posterior es incierto, nunca "fallido"
    if (!pref.init_point) throw new Error('sin init_point')
    await d.store.setIntentCheckout(intent.id, pref.init_point)
    return { url: pref.init_point }
  } catch (e) {
    // Solo un rechazo DEFINITIVO de MP (4xx, salvo 408/429) prueba que no se creó nada. Timeout, red, 5xx o respuesta rara =>
    // resultado INCIERTO: la intención sigue PENDIENTE (la conciliación la resuelve; la eliminación del usuario queda bloqueada).
    const definitive = !created && e instanceof MpApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429
    logMpFailure('one_time_failed', e, { mode: 'one_time', outcome: definitive ? 'definitive' : 'uncertain', mpCreated: created, intent: intent.id })
    if (definitive) {
      await d.store.failIntent(intent.id)
      throw new CheckoutError('No pudimos iniciar el pago con Mercado Pago. Probá de nuevo en unos minutos.')
    }
    await d.store.markIntentUncertain(intent.id).catch(() => undefined)
    throw new CheckoutError('No pudimos confirmar el inicio del pago con Mercado Pago. No se te cobró nada por este intento; esperá unos minutos antes de reintentar.')
  }
}

async function startRecurring(d: Deps, i: Input, plan: PlanRow, sub: SubRow): Promise<{ url: string }> {
  // payer_email lo exige Mercado Pago, pero NO es el vínculo con el usuario: ese vínculo es la fila del ledger
  // (su id viaja como external_reference) + el id de preapproval guardado, verificados contra la API.
  const payerEmail = (i.payerEmail?.trim() || i.email || '').trim()
  if (!EMAIL.test(payerEmail)) throw new CheckoutError('Ingresá un email válido de tu cuenta de Mercado Pago.')
  // Cada cuántos meses cobra Mercado Pago. Se valida ANTES de registrar nada: un período desconocido nunca se cobra por defecto.
  let months: number
  try { months = periodMonths(plan.billing_period) } catch { throw new CheckoutError('Este plan no tiene un período de cobro válido. Avisá a soporte.') }
  const deps = { mp: d.mp, store: d.store }

  // 1) Estado vigente del ledger (resolviendo creaciones a medias de intentos anteriores).
  let open = await d.store.listOpenPreapprovals(sub.id)
  for (const row of open.filter((r) => r.status === 'creating')) {
    if ((await resolveCreating(deps, row).catch(() => 'in_progress' as const)) === 'in_progress')
      throw new CheckoutError('Ya hay un intento de suscripción en curso. Esperá un momento y actualizá la página.')
  }
  open = await d.store.listOpenPreapprovals(sub.id)
  if (open.some((r) => r.status === 'authorized' || r.status === 'paused'))
    throw new CheckoutError('Ya tenés una renovación automática. Cancelala antes de elegir otra.')

  // 2) Mismo plan y monto, todavía sin autorizar y sin cancelaciones pendientes: se reutiliza el enlace.
  const reusable = open.length === 1 ? open[0] : null
  if (reusable && reusable.status === 'pending' && reusable.plan_id === plan.id && reusable.amount === plan.price && reusable.init_point)
    return { url: reusable.init_point }

  // 3) Reemplazo: la autorización anterior debe quedar CANCELADA Y CONFIRMADA antes de abrir otra.
  for (const row of open) {
    const res = await cancelPreapproval(deps, row)
    if (!res.ok) throw new CheckoutError('No pudimos confirmar la cancelación de tu autorización anterior en Mercado Pago, así que no creamos una nueva para evitar cobros duplicados. Ya quedó registrado; probá de nuevo en unos minutos.')
  }

  // 4) Se registra ANTES de crear en MP (el índice único cierra la carrera entre solicitudes simultáneas).
  let row: { id: string } | null
  try {
    row = await d.store.createPreapprovalRow({ subscriptionId: sub.id, planId: plan.id, amount: plan.price })
  } catch (e) {
    // La base es la autoridad: la cuenta se suspendió o inició su eliminación después de la lectura de arriba.
    if (e instanceof RenewalsBlockedError) throw new CheckoutError(BLOCKED_MESSAGE)
    throw e
  }
  if (!row) throw new CheckoutError('Ya hay un intento de suscripción en curso. Actualizá la página.')

  let pre: { id?: string; init_point?: string } | null = null
  try {
    pre = await d.mp.request<{ id?: string; init_point?: string }>('POST', '/preapproval', {
      reason: `OficioClaro – Plan ${plan.name}`,
      external_reference: row.id,
      payer_email: payerEmail,
      auto_recurring: { frequency: months, frequency_type: 'months', transaction_amount: plan.price, currency_id: 'ARS' },
      back_url: backUrl(d.appUrl, 'pending'),
      notification_url: `${d.appUrl}/api/mercadopago/webhook`,
      status: 'pending',
    }, row.id)
  } catch (e) {
    logMpFailure('recurring_create_failed', e, { mode: 'recurring', preapproval: row.id })
    // Resultado incierto (timeout/5xx): ¿MP la creó? Se busca por external_reference antes de dar el intento por fallido.
    const created = await d.store.getPreapprovalById(row.id)
    const outcome = created ? await resolveCreating(deps, created).catch(() => 'in_progress' as const) : 'in_progress' // si no aparece, queda 'creating' y se recupera luego (no se da por fallida con MP posiblemente en vuelo)
    if (outcome === 'attached') {
      const attached = await d.store.getPreapprovalById(row.id)
      if (attached?.init_point) return { url: attached.init_point }
    }
    throw new CheckoutError('No pudimos iniciar la suscripción con Mercado Pago. Probá de nuevo en unos minutos.')
  }
  if (!pre?.id || !pre.init_point) {
    await d.store.markPreapprovalFailed(row.id, 'respuesta sin id/init_point')
    throw new CheckoutError('Mercado Pago no devolvió el enlace de autorización.')
  }
  try {
    await d.store.attachPreapproval(row.id, pre.id, pre.init_point)
  } catch {
    // La base falló DESPUÉS de crear en MP: la fila queda 'creating' y se recupera por external_reference (cron / próximo intento).
    await d.store.logIncident('mp_preapprovals', row.id, 'mp_incident_attach_failed', { preapproval_id: pre.id })
    throw new CheckoutError('No pudimos terminar de registrar la suscripción. Probá de nuevo en unos minutos.')
  }
  return { url: pre.init_point }
}

// Cancela la renovación automática del propio usuario (el acceso sigue hasta el fin del período pagado).
// Solo informa éxito si MP confirmó la cancelación de TODAS las autorizaciones abiertas.
export async function cancelRenewal(d: Deps, userId: string): Promise<void> {
  const sub = await d.store.getLatestSubscription(userId)
  const open = sub ? await d.store.listOpenPreapprovals(sub.id) : []
  if (open.length === 0) throw new CheckoutError('No tenés una renovación automática para cancelar.')
  let failed = false
  for (const row of open) if (!(await cancelPreapproval({ mp: d.mp, store: d.store }, row)).ok) failed = true
  if (failed) throw new CheckoutError('No pudimos confirmar la cancelación en Mercado Pago. Ya quedó registrada y la reintentaremos; probá de nuevo en unos minutos.')
}

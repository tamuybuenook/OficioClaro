// Resumen de cuenta para el usuario (inicio, suscripción y perfil). Función pura: sin base, sin red, sin reloj propio.
// Los datos de entrada los lee y valida el SERVIDOR (suscripción, pagos y `access`, calculado con la fecha de Argentina).
// Esta capa solo traduce esos datos a textos y a una acción sugerida: no decide acceso ni activa nada.
import { fmtDay } from '@/lib/subscription-notice'
import { DEFAULT_PHASE_SETTINGS } from '@/lib/subscription-phase'

export type StateKey = 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'suspended' | 'none'
export type Tone = 'success' | 'warning' | 'neutral' | 'blue'

export const STATE_INFO: Record<StateKey, { label: string; tone: Tone }> = {
  trial: { label: 'Prueba gratuita', tone: 'blue' },
  active: { label: 'Activa', tone: 'success' },
  past_due: { label: 'Pago pendiente', tone: 'warning' },
  cancelled: { label: 'Sin renovación', tone: 'neutral' },
  expired: { label: 'Vencida', tone: 'warning' },
  suspended: { label: 'Suspendida', tone: 'warning' },
  none: { label: 'Sin plan', tone: 'neutral' },
}
export const stateInfo = (s: string | null | undefined) => STATE_INFO[(s as StateKey) in STATE_INFO ? (s as StateKey) : 'none']

/** Un pago tal como llega del servidor a las pantallas del usuario (solo campos propios y no sensibles). */
export type PaymentView = {
  id: string
  createdAt: string
  amount: number
  status: string
  provider: string
  planName: string | null
  reference: string | null
  proofUrl: string | null
}

export const providerLabel = (p: string) => (p === 'transfer' ? 'Transferencia' : p === 'mercadopago' ? 'Mercado Pago' : p)

/** Estados reales de `payments.status`: pending, reconciled, rejected, refunded. Cualquier otro se muestra tal cual, sin inventar. */
export function paymentStatusInfo(p: { status: string; provider: string }): { label: string; tone: Exclude<Tone, 'blue'>; hint: string | null } {
  switch (p.status) {
    case 'reconciled': return { label: 'Aprobado', tone: 'success', hint: 'Pago acreditado en tu suscripción.' }
    case 'pending':
      return p.provider === 'transfer'
        ? { label: 'En revisión', tone: 'warning', hint: 'Administración está verificando que el dinero haya ingresado. Tu suscripción se actualiza cuando lo confirme.' }
        : { label: 'Pendiente', tone: 'warning', hint: 'Esperando la confirmación de Mercado Pago.' }
    case 'rejected': return { label: 'Rechazado', tone: 'neutral', hint: 'No pudimos confirmar este pago. Si ya transferiste, escribinos con tu comprobante.' }
    case 'refunded': return { label: 'Reembolsado', tone: 'neutral', hint: 'Este pago fue devuelto.' }
    default: return { label: p.status, tone: 'neutral', hint: null }
  }
}

/** "Vence en 3 días" / "Vence hoy" / "Venció hace 2 días". `days` lo calcula el servidor (fecha de Argentina). */
export function daysText(state: StateKey, days: number | null): string | null {
  if (days === null || state === 'none') return null
  const n = Math.abs(days)
  const unit = n === 1 ? '1 día' : `${n} días`
  const trial = state === 'trial'
  if (days > 1) return trial ? `Tu prueba termina en ${unit}` : `Vence en ${unit}`
  if (days === 1) return trial ? 'Tu prueba termina mañana' : 'Vence mañana'
  if (days === 0) return trial ? 'Tu prueba termina hoy' : 'Vence hoy'
  return days === -1 ? 'Venció ayer' : `Venció hace ${unit}`
}

export type SubscriptionFacts = { planName: string; state: StateKey; endDate: string | null } | null
export type AccessFacts = { daysToEnd: number | null; locked: boolean }

export type AccountAction = { kind: 'choose_plan' | 'pay' | 'review_payment' | 'view_subscription'; label: string }
export type AccountNotice = { id: string; tone: 'info' | 'warning'; text: string }

export type AccountSummary = {
  planName: string
  state: StateKey
  stateLabel: string
  tone: Tone
  endLabel: string
  endCaption: string
  days: string | null
  action: AccountAction
  notices: AccountNotice[]
}

const DAY = 86_400_000
const RECENT_REJECTED_DAYS = 30

export function buildAccountSummary(input: { subscription: SubscriptionFacts; access: AccessFacts; payments: PaymentView[]; now?: number }): AccountSummary {
  const { subscription: sub, access, payments } = input
  const now = input.now ?? Date.now()
  const state: StateKey = sub?.state ?? 'none'
  const info = STATE_INFO[state]

  const pendingTransfers = payments.filter((p) => p.provider === 'transfer' && p.status === 'pending')
  const newest = [...payments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
  const rejected = newest && newest.provider === 'transfer' && newest.status === 'rejected' && now - new Date(newest.createdAt).getTime() <= RECENT_REJECTED_DAYS * DAY ? newest : null

  const notices: AccountNotice[] = []
  if (pendingTransfers.length > 0) {
    const total = pendingTransfers.reduce((s, p) => s + p.amount, 0)
    notices.push({ id: 'transfer-review', tone: 'info', text: pendingTransfers.length === 1
      ? `Tu transferencia de ${fmtMoney(total)} está en revisión. Cuando se confirme el ingreso, tu suscripción se actualiza.`
      : `Tenés ${pendingTransfers.length} transferencias en revisión (${fmtMoney(total)} en total).` })
  }
  if (rejected && pendingTransfers.length === 0) {
    notices.push({ id: 'transfer-rejected', tone: 'warning', text: `Tu última transferencia de ${fmtMoney(rejected.amount)} fue rechazada. Revisá el detalle o escribinos con tu comprobante.` })
  }

  const dueSoon = access.daysToEnd !== null && access.daysToEnd >= 0 && access.daysToEnd <= DEFAULT_PHASE_SETTINGS.noticeDays
  let action: AccountAction
  if (!sub) action = { kind: 'choose_plan', label: 'Elegir un plan' }
  else if (pendingTransfers.length > 0) action = { kind: 'review_payment', label: 'Ver el estado de mi pago' }
  else if (rejected) action = { kind: 'review_payment', label: 'Revisar mi pago' }
  else if (state === 'suspended') action = { kind: 'view_subscription', label: 'Ver mi suscripción' }
  else if (state === 'trial') action = { kind: 'choose_plan', label: dueSoon ? 'Elegir un plan antes de que termine' : 'Ver planes' }
  else if (state === 'expired' || state === 'past_due' || access.locked) action = { kind: 'pay', label: 'Informar una transferencia' }
  else if (dueSoon) action = { kind: 'pay', label: 'Pagar mi renovación' }
  else action = { kind: 'view_subscription', label: 'Ver mi suscripción' }

  return {
    planName: sub?.planName ?? 'Sin plan',
    state,
    stateLabel: info.label,
    tone: info.tone,
    endLabel: fmtDay(sub?.endDate ?? null),
    endCaption: state === 'expired' ? 'Venció el' : state === 'trial' ? 'Prueba hasta' : 'Acceso hasta',
    days: daysText(state, access.daysToEnd),
    action,
    notices,
  }
}

const fmtMoney = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

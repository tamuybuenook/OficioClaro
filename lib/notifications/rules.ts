// Qué avisos corresponden hoy a una suscripción (etapa 7a). Función pura: sin base, sin red, sin reloj propio.
// Diseño: docs/DISENO_SUSCRIPCIONES_ETAPA5.md §4. La tabla `notifications` (migración 0033) guarda el resultado.
import { daysBetween, type SubscriptionPhase } from '@/lib/subscription-phase'

export const NOTIFICATION_KINDS = [
  'trial_ending', 'auto_charge_upcoming', 'renewal_not_authorized', 'payment_failed',
  'manual_due_soon', 'grace_period', 'suspended_nonpayment', 'payment_confirmed',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]
export type Severity = 'info' | 'warning' | 'danger'

/** Solo los informativos se pueden descartar. Los de estado de cuenta se cierran solos al regularizar. */
export const DISMISSIBLE_KINDS: readonly NotificationKind[] = ['payment_confirmed']
/** Días que se muestra «pago confirmado». */
export const PAYMENT_CONFIRMED_DAYS = 7

/** Menor número = más importante (suspensión > gracia > pago fallido > avisos > informativos). */
export const KIND_PRIORITY: Record<NotificationKind, number> = {
  suspended_nonpayment: 1, grace_period: 2, payment_failed: 3,
  renewal_not_authorized: 4, manual_due_soon: 4, trial_ending: 4, auto_charge_upcoming: 4, payment_confirmed: 5,
}

export type DesiredNotification = {
  kind: NotificationKind
  dedupe_key: string
  due_date: string | null
  severity: Severity
  source: 'subscription' | 'payment'
  subscription_id: string
  action: { label: string; url: string }
  payload: Record<string, string | number | null>
}

export type RulesInput = {
  subscriptionId: string
  phase: SubscriptionPhase
  daysToEnd: number | null
  graceEndsOn: string | null
  endDate: string | null
  subStatus: string | null
  noticeDays: number
  /** Último pago confirmado de la suscripción, si lo hay. */
  lastPayment?: { id: string; date: string } | null // date: YYYY-MM-DD
  today: string
}

const PAY = { label: 'Ir a Suscripción', url: '/?vista=suscripcion' }

export function desiredNotifications(i: RulesInput): DesiredNotification[] {
  const out: DesiredNotification[] = []
  const sid = i.subscriptionId
  const ref = i.endDate ?? 'sin-fecha'
  const inWindow = i.daysToEnd !== null && i.daysToEnd <= i.noticeDays
  const add = (kind: NotificationKind, severity: Severity, due: string | null, payload: DesiredNotification['payload'] = {}, key = `${kind}:${sid}:${ref}`, source: DesiredNotification['source'] = 'subscription') =>
    out.push({ kind, dedupe_key: key, due_date: due, severity, source, subscription_id: sid, action: PAY, payload: { end_date: i.endDate, ...payload } })

  switch (i.phase) {
    case 'trial_ending': add('trial_ending', 'info', i.endDate, { days: i.daysToEnd }); break
    case 'active_auto': if (inWindow) add('auto_charge_upcoming', 'info', i.endDate, { days: i.daysToEnd }); break
    case 'renewal_off': if (inWindow) add('renewal_not_authorized', 'warning', i.endDate, { days: i.daysToEnd }); break
    case 'active_manual': if (inWindow) add('manual_due_soon', 'warning', i.endDate, { days: i.daysToEnd }); break
    case 'payment_failed': add('payment_failed', 'warning', i.endDate, { days: i.daysToEnd }); break
    case 'grace': add('grace_period', 'warning', i.graceEndsOn, { grace_ends_on: i.graceEndsOn }); break
    case 'lapsed': add('suspended_nonpayment', 'danger', i.endDate, { reason: i.subStatus === 'trial' ? 'trial_ended' : 'unpaid' }); break
    default: break // none, trial, cancelled_end, suspended_admin: sin aviso
  }

  const lp = i.lastPayment
  if (lp && daysBetween(lp.date, i.today) >= 0 && daysBetween(lp.date, i.today) <= PAYMENT_CONFIRMED_DAYS)
    add('payment_confirmed', 'info', lp.date, { payment_id: lp.id }, `payment_confirmed:${sid}:${lp.id}`, 'payment')
  return out
}

/** El aviso a mostrar en el banner: el de mayor prioridad (a igual prioridad, el más reciente por vencimiento). */
export function pickBanner<T extends { kind: NotificationKind; due_date: string | null }>(list: T[]): T | null {
  if (list.length === 0) return null
  return [...list].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || (b.due_date ?? '').localeCompare(a.due_date ?? ''))[0]
}

/** ¿Las claves abiertas en la base ya coinciden con las deseadas? Si sí, no hace falta escribir nada. */
export function inSync(openKeys: string[], desired: DesiredNotification[]): boolean {
  const a = new Set(openKeys); const b = new Set(desired.map((d) => d.dedupe_key))
  return a.size === b.size && [...a].every((k) => b.has(k))
}

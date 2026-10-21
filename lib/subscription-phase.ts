// Fase de una suscripción, calculada (sin estados nuevos en la base). Función pura: sin base, sin red, sin reloj propio.
// Diseño: docs/DISENO_SUSCRIPCIONES_ETAPA5.md. NO reemplaza todavía a hasAccess (etapa 6c).
import { todayAR } from '@/lib/subscription-access'

export type PhaseSettings = { noticeDays: number; graceDays: number }
export const DEFAULT_PHASE_SETTINGS: PhaseSettings = { noticeDays: 5, graceDays: 5 }

export type SubscriptionPhase =
  | 'none' | 'trial' | 'trial_ending' | 'active_auto' | 'active_manual' | 'renewal_off'
  | 'payment_failed' | 'grace' | 'cancelled_end' | 'lapsed' | 'suspended_admin'

export type PhaseInput = {
  status: string
  end_date: string | null // YYYY-MM-DD
  /** Hay una autorización de renovación automática vigente en Mercado Pago. */
  autoRenewal?: boolean
  /** El usuario canceló la renovación automática (el período pagado sigue vigente). */
  renewalCancelled?: boolean
  /** Existe al menos un pago confirmado (payments.status = 'reconciled') de esta suscripción. */
  hasPaidBefore?: boolean
}

export type PhaseResult = {
  phase: SubscriptionPhase
  hasAccess: boolean
  /** Días hasta end_date (negativo si ya pasó). null si no hay fecha. */
  daysToEnd: number | null
  /** Último día de gracia (solo en fase 'grace'). */
  graceEndsOn: string | null
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

/** Valores de app_settings inválidos o ausentes vuelven a los iniciales (aviso 1–15, gracia 0–30). */
export function normalizeSettings(raw?: Partial<Record<keyof PhaseSettings, unknown>> | null): PhaseSettings {
  return {
    noticeDays: clampInt(raw?.noticeDays, 1, 15, DEFAULT_PHASE_SETTINGS.noticeDays),
    graceDays: clampInt(raw?.graceDays, 0, 30, DEFAULT_PHASE_SETTINGS.graceDays),
  }
}

const DAY = 86_400_000
function toUtc(d: string): number { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) }
export function daysBetween(from: string, to: string): number { return Math.round((toUtc(to) - toUtc(from)) / DAY) }
export function addDays(d: string, n: number): string { return new Date(toUtc(d) + n * DAY).toISOString().slice(0, 10) }

export function getSubscriptionPhase(sub: PhaseInput | null | undefined, rawSettings?: Partial<Record<keyof PhaseSettings, unknown>> | null, today: string = todayAR()): PhaseResult {
  const s = normalizeSettings(rawSettings)
  const no = (phase: SubscriptionPhase, daysToEnd: number | null = null): PhaseResult => ({ phase, hasAccess: false, daysToEnd, graceEndsOn: null })
  const yes = (phase: SubscriptionPhase, daysToEnd: number | null): PhaseResult => ({ phase, hasAccess: true, daysToEnd, graceEndsOn: null })

  if (!sub) return no('none')
  if (sub.status === 'suspended') return no('suspended_admin')
  if (!['trial', 'active', 'past_due', 'cancelled'].includes(sub.status)) return no('lapsed')

  // Histórico: activa sin vencimiento cargado conserva el acceso (igual que hasAccess).
  if (!sub.end_date) return sub.status === 'active' ? yes('active_manual', null) : no('lapsed')

  const days = daysBetween(today, sub.end_date)
  if (days >= 0) {
    switch (sub.status) {
      case 'trial': return yes(days <= s.noticeDays ? 'trial_ending' : 'trial', days)
      case 'past_due': return yes('payment_failed', days)
      case 'cancelled': return yes('cancelled_end', days)
      default: return yes(sub.autoRenewal ? 'active_auto' : sub.renewalCancelled ? 'renewal_off' : 'active_manual', days)
    }
  }

  // Período vencido. Gracia solo para quien ya pagó y no canceló por su cuenta ni terminó la prueba sin pagar.
  const graceEligible = (sub.status === 'active' || sub.status === 'past_due') && sub.hasPaidBefore === true && s.graceDays > 0
  if (graceEligible && -days <= s.graceDays) return { phase: 'grace', hasAccess: true, daysToEnd: days, graceEndsOn: addDays(sub.end_date, s.graceDays) }
  return no('lapsed', days)
}

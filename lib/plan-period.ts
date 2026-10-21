// Períodos de facturación de los planes. ÚNICA fuente en TypeScript (la base usa public.plan_period_months, migración 0032).
export const PLAN_PERIODS = ['monthly', 'quarterly', 'semiannual', 'yearly'] as const
export type PlanPeriod = (typeof PLAN_PERIODS)[number]

const MONTHS: Record<PlanPeriod, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 }
const ADJECTIVE: Record<PlanPeriod, string> = { monthly: 'mensual', quarterly: 'trimestral', semiannual: 'semestral', yearly: 'anual' }
const UNIT: Record<PlanPeriod, string> = { monthly: 'mes', quarterly: '3 meses', semiannual: '6 meses', yearly: 'año' }
const OPTION: Record<PlanPeriod, string> = { monthly: 'Mensual', quarterly: 'Trimestral (3 meses)', semiannual: 'Semestral (6 meses)', yearly: 'Anual' }

export function isPlanPeriod(v: unknown): v is PlanPeriod {
  return typeof v === 'string' && (PLAN_PERIODS as readonly string[]).includes(v)
}

/** Meses que cubre un pago del plan. Falla ante un valor desconocido: nunca se asume «mensual» ni «anual» en silencio. */
export function periodMonths(v: unknown): number {
  if (!isPlanPeriod(v)) throw new Error(`Período de plan no soportado: ${String(v)}`)
  return MONTHS[v]
}

/** «mensual», «trimestral», «semestral», «anual». Valor desconocido: cadena vacía (la pantalla no se rompe). */
export const periodAdjective = (v: unknown): string => (isPlanPeriod(v) ? ADJECTIVE[v] : '')
/** Para «$X / ___»: «mes», «3 meses», «6 meses», «año». */
export const periodUnit = (v: unknown): string => (isPlanPeriod(v) ? UNIT[v] : '')
/** Texto de las opciones del selector del admin. */
export const periodOptionLabel = (v: PlanPeriod): string => OPTION[v]

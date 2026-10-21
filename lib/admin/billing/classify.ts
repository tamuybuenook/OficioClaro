// Clasificación ÚNICA de pagos para el panel de facturación. Los totales y los filtros del listado
// derivan de esta misma definición (hay una prueba de paridad en classify.test.ts).
//
// Reglas (fuente: estados reales de `payments`, ver migraciones 0023 y 0026–0030):
//  - cobrado:    status='reconciled' y (transferencia, o pago de MP ya aplicado: applied_at no nulo).
//  - retenido:   MP aprobado, no aplicado, con review_reason y sin resolución (a la espera de revisión).
//  - reembolso_pendiente: review_resolution='refund_pending' (hay que devolver el dinero).
//  - reembolsado: status='refunded' o review_resolution='refunded'. NUNCA suma como cobro.
//  - sin_aplicar: MP aprobado, no aplicado y sin motivo de retención. No debería ocurrir: se lista como problema.
//  - pendiente / rechazado: según status. Un intento de pago sin external_id NO es un ingreso.
export type Provider = 'mercadopago' | 'transfer'
export type Category = 'cobrado' | 'retenido' | 'reembolso_pendiente' | 'reembolsado' | 'sin_aplicar' | 'pendiente' | 'rechazado'
export const CATEGORIES: Category[] = ['cobrado', 'pendiente', 'rechazado', 'reembolsado', 'retenido', 'reembolso_pendiente', 'sin_aplicar']

export type PaymentFacts = {
  provider: string
  status: string
  applied_at: string | null
  review_reason: string | null
  review_resolution: string | null
  external_id?: string | null
}

export function classifyPayment(p: PaymentFacts): Category {
  if (p.status === 'refunded' || p.review_resolution === 'refunded') return 'reembolsado'
  if (p.review_resolution === 'refund_pending') return 'reembolso_pendiente'
  if (p.status === 'reconciled') {
    if (p.provider === 'transfer' || p.applied_at) return 'cobrado'
    if (p.review_reason && !p.review_resolution) return 'retenido'
    return 'sin_aplicar'
  }
  if (p.status === 'rejected') return 'rechazado'
  return 'pendiente'
}

/** Intento de cobro de MP todavía sin pago asociado (no es un ingreso ni un pendiente en MP). */
export const isUnpaidIntent = (p: PaymentFacts) => p.provider === 'mercadopago' && p.status === 'pending' && !p.external_id

export const CATEGORY_LABEL: Record<Category, string> = {
  cobrado: 'Cobrado', pendiente: 'Pendiente', rechazado: 'Rechazado', reembolsado: 'Reembolsado',
  retenido: 'Retenido (revisar)', reembolso_pendiente: 'Reembolso pendiente', sin_aplicar: 'Sin aplicar (revisar)',
}
export const CATEGORY_TONE: Record<Category, 'success' | 'warning' | 'neutral' | 'blue'> = {
  cobrado: 'success', pendiente: 'blue', rechazado: 'neutral', reembolsado: 'neutral',
  retenido: 'warning', reembolso_pendiente: 'warning', sin_aplicar: 'warning',
}
export const PROVIDER_LABEL: Record<string, string> = { mercadopago: 'Mercado Pago', transfer: 'Transferencia' }

// ---- Filtros de listado: espejo exacto de classifyPayment ----
// `q` es un constructor de consultas de PostgREST (eq / is / not / or). Se usa solo con este subconjunto.
export type FilterBuilder<T> = {
  eq(col: string, v: string): T
  is(col: string, v: null): T
  not(col: string, op: string, v: null): T
  or(expr: string): T
}

export function applyCategoryFilter<T extends FilterBuilder<T>>(q: T, c: Category): T {
  const resolutionOpen = 'review_resolution.is.null,review_resolution.eq.applied' // sin resolución de reembolso
  switch (c) {
    case 'cobrado': return q.eq('status', 'reconciled').or('provider.eq.transfer,applied_at.not.is.null').or(resolutionOpen)
    case 'retenido': return q.eq('status', 'reconciled').eq('provider', 'mercadopago').is('applied_at', null).not('review_reason', 'is', null).is('review_resolution', null)
    case 'reembolso_pendiente': return q.eq('review_resolution', 'refund_pending').or('status.neq.refunded')
    case 'reembolsado': return q.or('status.eq.refunded,review_resolution.eq.refunded')
    case 'sin_aplicar': return q.eq('status', 'reconciled').eq('provider', 'mercadopago').is('applied_at', null).or('review_reason.is.null,review_resolution.eq.applied').or(resolutionOpen)
    case 'pendiente': return q.eq('status', 'pending').or(resolutionOpen)
    case 'rechazado': return q.eq('status', 'rejected').or(resolutionOpen)
  }
}

// ---- Resumen ----
export type SummaryRow = PaymentFacts & { amount: number | string }
export type Bucket = { count: number; amount: number }
export type ProviderSummary = Record<Category, Bucket> & { unpaid_intents: number }
export type PaymentsSummary = { total: ProviderSummary; byProvider: Record<Provider, ProviderSummary>; rows: number }

const emptyBucket = (): Bucket => ({ count: 0, amount: 0 })
export const emptyProviderSummary = (): ProviderSummary => ({
  cobrado: emptyBucket(), retenido: emptyBucket(), reembolso_pendiente: emptyBucket(), reembolsado: emptyBucket(),
  sin_aplicar: emptyBucket(), pendiente: emptyBucket(), rechazado: emptyBucket(), unpaid_intents: 0,
})

const cents = (v: number | string) => Math.round(Number(v) * 100)

/** Suma en centavos enteros (evita errores de punto flotante) y devuelve pesos. */
export function summarizePayments(rows: SummaryRow[]): PaymentsSummary {
  const acc = { total: emptyProviderSummary(), mercadopago: emptyProviderSummary(), transfer: emptyProviderSummary() }
  const sums = { total: {} as Record<string, number>, mercadopago: {} as Record<string, number>, transfer: {} as Record<string, number> }
  for (const r of rows) {
    const cat = classifyPayment(r)
    const prov: Provider | null = r.provider === 'mercadopago' ? 'mercadopago' : r.provider === 'transfer' ? 'transfer' : null
    const targets: ('total' | Provider)[] = prov ? ['total', prov] : ['total']
    for (const t of targets) {
      acc[t][cat].count += 1
      sums[t][cat] = (sums[t][cat] ?? 0) + cents(r.amount)
      if (isUnpaidIntent(r)) acc[t].unpaid_intents += 1
    }
  }
  for (const t of ['total', 'mercadopago', 'transfer'] as const) for (const c of CATEGORIES) acc[t][c].amount = (sums[t][c] ?? 0) / 100
  return { total: acc.total, byProvider: { mercadopago: acc.mercadopago, transfer: acc.transfer }, rows: rows.length }
}

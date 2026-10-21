import { describe, it, expect } from 'vitest'
import { applyPaymentFilters, summarizeSubscriptions, fetchPaymentsSummary, fetchCoveredUntil, SCAN_CAP, findSubscriptionIdsByUserText } from './queries'
import { parseBillingFilters } from './filters'

const NOW = new Date('2026-10-18T15:00:00-03:00')

// Constructor que graba las llamadas encadenadas.
function recorder() {
  const calls: [string, any[]][] = []
  const p: any = new Proxy({}, { get: (_t, name: string) => (...args: any[]) => { calls.push([name, args]); return p } })
  return { q: p, calls }
}

describe('applyPaymentFilters', () => {
  it('aplica rango, proveedor y estado', () => {
    const { q, calls } = recorder()
    applyPaymentFilters(q, parseBillingFilters({ proveedor: 'mercadopago', estado: 'retenido' }, NOW), [])
    expect(calls.map((c) => c[0])).toEqual(['gte', 'lt', 'eq', 'eq', 'eq', 'is', 'not', 'is'])
    expect(calls[0][1]).toEqual(['created_at', '2026-10-01T03:00:00.000Z'])
    expect(calls[2][1]).toEqual(['provider', 'mercadopago'])
  })
  it('texto: busca en external_id/reference y en las suscripciones del usuario, sin sintaxis inyectada', () => {
    const { q, calls } = recorder()
    applyPaymentFilters(q, parseBillingFilters({ q: 'perez,id.eq.1)', periodo: 'todo' }, NOW), ['s1', 's2'])
    const or = calls.find((c) => c[0] === 'or')![1][0] as string
    expect(or).toContain('external_id.ilike.%perez id.eq.1%')
    expect(or).toContain('subscription_id.in.(s1,s2)')
    expect(or.replace(/\(s1,s2\)/, '()').split(',').length).toBe(3)   // ninguna coma extra venida del usuario
  })
  it('uuid: pago, suscripción o usuario', () => {
    const { q, calls } = recorder()
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    applyPaymentFilters(q, parseBillingFilters({ q: id, periodo: 'todo' }, NOW), ['sX'])
    expect(calls.find((c) => c[0] === 'or')![1][0]).toBe(`id.eq.${id},subscription_id.eq.${id},subscription_id.in.(sX)`)
  })
})

describe('resumen de suscripciones', () => {
  const R = (user_id: string, status: string, end_date: string | null, mp_status: string | null = null) => ({ user_id, status, end_date, mp_status })
  it('toma la suscripción más reciente de cada usuario y cuenta estados reales', () => {
    const s = summarizeSubscriptions([
      R('a', 'active', '2026-11-10', 'authorized'),   // más reciente de a
      R('a', 'active', '2026-01-10'),                 // vieja: ignorada
      R('b', 'active', '2026-09-01'),                 // vencida
      R('c', 'trial', '2026-10-30'),
      R('d', 'past_due', '2026-10-20', 'authorized'),
      R('e', 'cancelled', '2026-10-25'),
      R('f', 'suspended', '2026-12-01'),
      R('g', 'active', '2026-09-01', 'authorized'),   // vencida pero con autorización: se marca aparte
    ], '2026-10-18')
    expect(s).toMatchObject({ users: 7, active: 1, expired: 2, trial: 1, past_due: 1, cancelled_with_access: 1, suspended: 1, auto_renew: 2, none_with_mp_auth_but_no_access: 1 })
  })
})

describe('lectura por trozos', () => {
  function fakeDb(total: number) {
    const requests: [number, number][] = []
    const make = (): any => { const q: any = { select: () => q, order: () => q, gte: () => q, lt: () => q, range: async (a: number, b: number) => { requests.push([a, b]); const n = Math.max(0, Math.min(b + 1, total) - a); return { data: Array.from({ length: n }, () => ({ provider: 'transfer', status: 'reconciled', applied_at: null, review_reason: null, review_resolution: null, external_id: null, amount: 1 })), error: null } } }; return q }
    return { db: { from: () => make() } as any, requests }
  }
  it('pagina de a 1000 y no marca parcial si termina', async () => {
    const { db, requests } = fakeDb(2500)
    const { summary, truncated } = await fetchPaymentsSummary(db, { range: { fromIso: null, toIso: null } })
    expect(requests).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(summary.total.cobrado).toEqual({ count: 2500, amount: 2500 }); expect(truncated).toBe(false)
  })
  it('marca parcial al llegar al tope', async () => {
    const { db } = fakeDb(SCAN_CAP + 5000)
    const { summary, truncated } = await fetchPaymentsSummary(db, { range: { fromIso: null, toIso: null } })
    expect(truncated).toBe(true); expect(summary.rows).toBe(SCAN_CAP)
  })
})

describe('período cubierto', () => {
  it('toma end_date de la auditoría del propio pago (la más reciente por pago)', async () => {
    const logs = [
      { entity_id: 'p1', action: 'held_payment_apply', new_value: { end_date: '2026-12-10' }, created_at: '2026-10-02' },
      { entity_id: 'p1', action: 'mp_approved', new_value: { end_date: '2026-11-10' }, created_at: '2026-10-01' },
      { entity_id: 'p2', action: 'reconcile', new_value: { status: 'rejected', end_date: null }, created_at: '2026-10-01' },
    ]
    const db: any = { from: () => { const q: any = { select: () => q, eq: () => q, in: () => q, order: async () => ({ data: logs, error: null }) }; return q } }
    const m = await fetchCoveredUntil(db, ['p1', 'p2'])
    expect(m.get('p1')).toBe('2026-12-10'); expect(m.has('p2')).toBe(false)
  })
})

describe('búsqueda por usuario', () => {
  it('sin coincidencias de nombre no consulta suscripciones', async () => {
    let subscriptionsQueried = false
    const db: any = { from: (t: string) => { if (t === 'subscriptions') subscriptionsQueried = true; const q: any = { select: () => q, ilike: () => q, in: () => q, limit: async () => ({ data: [], error: null }) }; return q } }
    expect(await findSubscriptionIdsByUserText(db, { q: 'zzz', qKind: 'text' })).toEqual([])
    expect(subscriptionsQueried).toBe(false)
  })
})

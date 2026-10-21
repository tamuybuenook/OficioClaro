import { describe, it, expect } from 'vitest'
import { classifyPayment, applyCategoryFilter, summarizePayments, isUnpaidIntent, CATEGORIES, type Category, type FilterBuilder } from './classify'

// Mini evaluador del subconjunto de PostgREST que usa applyCategoryFilter (mismas semánticas SQL).
type Row = Record<string, string | null>
class FakeQuery implements FilterBuilder<FakeQuery> {
  preds: ((r: Row) => boolean)[] = []
  eq(c: string, v: string) { this.preds.push((r) => r[c] === v); return this }
  is(c: string, _v: null) { this.preds.push((r) => r[c] === null); return this }
  not(c: string, op: string, _v: null) { if (op !== 'is') throw new Error('op'); this.preds.push((r) => r[c] !== null); return this }
  or(expr: string) {
    const conds = expr.split(',').map((x) => {
      const m = x.match(/^(\w+)\.(eq|neq|is|not\.is)\.(.*)$/); if (!m) throw new Error('expr ' + x)
      const [, col, op, val] = m
      return (r: Row) => op === 'eq' ? r[col] === val : op === 'neq' ? (r[col] !== null && r[col] !== val) : op === 'is' ? r[col] === null : r[col] !== null
    })
    this.preds.push((r) => conds.some((f) => f(r))); return this
  }
  match(r: Row) { return this.preds.every((f) => f(r)) }
}

const space: Row[] = []
for (const status of ['pending', 'reconciled', 'rejected', 'refunded'])
  for (const provider of ['mercadopago', 'transfer'])
    for (const applied_at of [null, '2026-10-01T00:00:00Z'])
      for (const review_reason of [null, 'subscription_suspended'])
        for (const review_resolution of [null, 'applied', 'refund_pending', 'refunded'])
          space.push({ status, provider, applied_at, review_reason, review_resolution })

describe('clasificación de pagos', () => {
  it('paridad exacta: cada combinación cae en UNA categoría y el filtro SQL coincide con classifyPayment', () => {
    for (const row of space) {
      const cat = classifyPayment(row as any)
      const hits = CATEGORIES.filter((c) => applyCategoryFilter(new FakeQuery(), c).match(row))
      expect(hits, JSON.stringify(row)).toEqual([cat])
    }
  })

  it('casos de negocio', () => {
    const base = { provider: 'mercadopago', applied_at: null, review_reason: null, review_resolution: null }
    expect(classifyPayment({ ...base, status: 'reconciled', applied_at: 'x' })).toBe('cobrado')
    expect(classifyPayment({ ...base, status: 'reconciled', provider: 'transfer' })).toBe('cobrado')
    expect(classifyPayment({ ...base, status: 'reconciled', review_reason: 'subscription_cancelled' })).toBe('retenido')
    expect(classifyPayment({ ...base, status: 'reconciled', review_reason: 'subscription_cancelled', review_resolution: 'refund_pending' })).toBe('reembolso_pendiente')
    expect(classifyPayment({ ...base, status: 'reconciled', review_reason: 'subscription_cancelled', review_resolution: 'refunded' })).toBe('reembolsado')
    expect(classifyPayment({ ...base, status: 'refunded', applied_at: 'x' })).toBe('reembolsado')
    expect(classifyPayment({ ...base, status: 'reconciled' })).toBe('sin_aplicar')
    expect(classifyPayment({ ...base, status: 'pending' })).toBe('pendiente')
    expect(classifyPayment({ ...base, status: 'rejected' })).toBe('rechazado')
  })

  it('un intento sin external_id no es ingreso y se cuenta aparte', () => {
    expect(isUnpaidIntent({ provider: 'mercadopago', status: 'pending', applied_at: null, review_reason: null, review_resolution: null, external_id: null })).toBe(true)
    expect(isUnpaidIntent({ provider: 'mercadopago', status: 'pending', applied_at: null, review_reason: null, review_resolution: null, external_id: '123' })).toBe(false)
    expect(isUnpaidIntent({ provider: 'transfer', status: 'pending', applied_at: null, review_reason: null, review_resolution: null })).toBe(false)
  })
})

describe('resumen', () => {
  const r = (over: Partial<any>) => ({ provider: 'mercadopago', status: 'reconciled', applied_at: 'x', review_reason: null, review_resolution: null, external_id: 'E', amount: 5000, ...over })
  const rows = [
    r({ amount: '5000.00' }), r({ amount: 8000.10 }), r({ amount: 0.1 }), r({ amount: 0.2 }),
    r({ provider: 'transfer', applied_at: null, external_id: null, amount: 9000 }),
    r({ status: 'pending', applied_at: null, external_id: null, amount: 5000 }),               // intento
    r({ status: 'pending', applied_at: null, amount: 5000 }),                                  // pendiente en MP
    r({ status: 'rejected', applied_at: null, amount: 5000 }),
    r({ status: 'refunded', amount: 8000 }),
    r({ applied_at: null, review_reason: 'subscription_suspended', amount: 8000 }),             // retenido
    r({ applied_at: null, review_reason: 'subscription_suspended', review_resolution: 'refund_pending', amount: 9000 }),
  ]
  const s = summarizePayments(rows)
  it('cobrado excluye intentos, pendientes, rechazados, retenidos y reembolsos', () => {
    expect(s.total.cobrado).toEqual({ count: 5, amount: 22000.4 })   // 5000 + 8000.10 + 0.1 + 0.2 + 9000 (transfer)
    expect(s.byProvider.mercadopago.cobrado).toEqual({ count: 4, amount: 13000.4 })
    expect(s.byProvider.transfer.cobrado).toEqual({ count: 1, amount: 9000 })
    expect(s.total.pendiente.count).toBe(2); expect(s.total.unpaid_intents).toBe(1)
    expect(s.total.reembolsado).toEqual({ count: 1, amount: 8000 })
    expect(s.total.retenido.count).toBe(1); expect(s.total.reembolso_pendiente.count).toBe(1)
  })
  it('suma en centavos (0,1 + 0,2 exacto) y los reembolsos no restan de lo cobrado', () => {
    const t = summarizePayments([r({ amount: 0.1 }), r({ amount: 0.2 }), r({ status: 'refunded', amount: 5000 })])
    expect(t.total.cobrado.amount).toBe(0.3)
  })
  it('cada fila se cuenta una sola vez por proveedor y en el total', () => {
    const cats = Object.keys(s.total).filter((k) => k !== 'unpaid_intents') as Category[]
    const sumCount = (p: any) => cats.reduce((n, c) => n + p[c].count, 0)
    expect(sumCount(s.total)).toBe(rows.length)
    expect(sumCount(s.byProvider.mercadopago) + sumCount(s.byProvider.transfer)).toBe(rows.length)
  })
})

import { describe, it, expect } from 'vitest'
import { getPricingBatch } from './pricingBatch'
import { getServicePricing } from './pricing'
import { vi } from 'vitest'

const holder: { client: any } = { client: null }
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => holder.client }))

// Cliente falso mínimo: una tabla por nombre, filtros eq/in/lte y orden. Cuenta las consultas.
type Row = Record<string, any>
function stub(tables: Record<string, Row[]>) {
  const calls: string[] = []
  const client = {
    from(table: string) {
      calls.push(table)
      let rows = [...(tables[table] ?? [])]
      const q: any = {
        select: () => q,
        in: (c: string, vs: any[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q },
        eq: (c: string, v: any) => { rows = rows.filter((r) => r[c] === v); return q },
        lte: (c: string, v: any) => { rows = rows.filter((r) => r[c] <= v); return q },
        order: (c: string, o?: any) => { rows.sort((a, b) => (a[c] < b[c] ? 1 : -1) * (o?.ascending === false ? 1 : -1)); return q },
        limit: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { code: 'PGRST116' } }),
        then: (ok: any, bad: any) => Promise.resolve({ data: rows, error: null }).then(ok, bad),
      }
      return q
    },
  }
  return { client: client as any, calls }
}

function world(n: number) {
  const services = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, ut_coefficient: i % 3 === 0 ? 2 : null, categories: { trade_id: i % 2 ? 't1' : 't2' } }))
  return {
    services,
    price_lists: [{ id: 'l1', trade_id: 't1' }, { id: 'l2', trade_id: 't2' }],
    price_list_versions: [
      { id: 'v1old', price_list_id: 'l1', status: 'published', effective_date: '2026-01-01' },
      { id: 'v1', price_list_id: 'l1', status: 'published', effective_date: '2026-09-01' },
      { id: 'v1fut', price_list_id: 'l1', status: 'published', effective_date: '2027-01-01' },
      { id: 'v1draft', price_list_id: 'l1', status: 'draft', effective_date: '2026-10-01' },
      { id: 'v2', price_list_id: 'l2', status: 'published', effective_date: '2026-09-01' },
    ],
    price_items: services.flatMap((s, i) => [
      { service_id: s.id, price_list_version_id: i % 2 ? 'v1' : 'v2', base_price: 1000 + i },
      { service_id: s.id, price_list_version_id: 'v1old', base_price: 1 },
    ]),
    profiles: [{ id: 'u1', unit_value: 500 }],
    user_price_items: [{ user_id: 'u1', service_id: 's1', custom_price: 7777, custom_ut_coefficient: null }, { user_id: 'u2', service_id: 's2', custom_price: 1, custom_ut_coefficient: null }],
  }
}

describe('getPricingBatch', () => {
  it('usa la versión publicada vigente (no la vieja, ni la futura, ni el borrador)', async () => {
    const { client } = stub(world(4))
    const m = await getPricingBatch(client, 'u1', ['s1', 's2'], '2026-10-23')
    expect(m.get('s1')?.basePrice).toBe(1001)
    expect(m.get('s2')?.basePrice).toBe(1002)
  })
  it('respeta la prioridad de precio personal: explícito > UT > referencia', async () => {
    const { client } = stub(world(4))
    const m = await getPricingBatch(client, 'u1', ['s0', 's1', 's2', 's3'], '2026-10-23')
    expect(m.get('s1')).toMatchObject({ personalPrice: 7777, personalSource: 'custom' })   // precio propio
    expect(m.get('s0')).toMatchObject({ personalPrice: 1000, personalSource: 'ut' })       // 2 UT × 500
    expect(m.get('s2')).toMatchObject({ personalPrice: 1002, personalSource: 'reference' })
  })
  it('no usa precios personalizados de OTRO usuario', async () => {
    const { client } = stub(world(4))
    const m = await getPricingBatch(client, 'u1', ['s2'], '2026-10-23')
    expect(m.get('s2')?.personalPrice).toBe(1002)
  })
  it('un servicio sin lista/versión/ítem no devuelve precio', async () => {
    const w: any = world(2); w.price_items = []
    const { client } = stub(w)
    expect((await getPricingBatch(client, 'u1', ['s0', 's1'], '2026-10-23')).size).toBe(0)
  })
  it('sin servicios no consulta nada', async () => {
    const { client, calls } = stub(world(1))
    expect((await getPricingBatch(client, 'u1', [])).size).toBe(0)
    expect(calls).toHaveLength(0)
  })
  it('la cantidad de consultas NO crece con la cantidad de servicios (antes: ~6 por servicio)', async () => {
    const a = stub(world(5)); await getPricingBatch(a.client, 'u1', Array.from({ length: 5 }, (_, i) => `s${i}`), '2026-10-23')
    const b = stub(world(100)); await getPricingBatch(b.client, 'u1', Array.from({ length: 100 }, (_, i) => `s${i}`), '2026-10-23')
    expect(b.calls.length).toBe(a.calls.length)
    expect(b.calls.length).toBeLessThanOrEqual(8)
    const c = stub(world(450)); await getPricingBatch(c.client, 'u1', Array.from({ length: 450 }, (_, i) => `s${i}`), '2026-10-23')
    // más de 100 ids se parten en bloques (límite de URL), pero sigue siendo ~3 por bloque, no ~6 por servicio
    expect(c.calls.length).toBeLessThan(450 * 6 / 20)
  })

  it('devuelve EXACTAMENTE lo mismo que el cálculo original servicio por servicio', async () => {
    const w: any = world(30)
    const { client } = stub(w)
    // el servicio original pide `categories(trade_id)` con .single(): el stub devuelve la fila completa
    holder.client = client
    const ids = w.services.map((x: any) => x.id)
    const batch = await getPricingBatch(client, 'u1', ids, new Date().toISOString().slice(0, 10))
    expect(batch.size).toBeGreaterThan(0) // la comparación no puede ser vacía
    for (const id of ids) {
      const one = await getServicePricing(id, 'u1')
      expect(batch.get(id) ?? null).toEqual(one)
    }
  })
})

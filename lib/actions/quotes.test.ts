import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeDb, fakeSupabaseClient, type FakeDb } from '@/lib/testing/fake-supabase'

// Base EN MEMORIA (ver lib/testing/fake-supabase.ts): verifica la lógica de addQuoteItem, no el SQL.
const ctx: { db: FakeDb; price: number } = { db: createFakeDb(), price: 1000 }
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/services/access', () => ({ requireFullAccess: async () => null }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeSupabaseClient(ctx.db, 'u1') }))
vi.mock('@/lib/services/quotes', () => ({ getMyQuotes: async () => [], getQuoteWithItems: async () => ({}) }))
vi.mock('@/lib/services/pricing', () => ({
  getServicePricing: async () => ({ personalPrice: ctx.price }),
  round2: (n: number) => Math.round(n * 100) / 100,
}))

import { addQuoteItem, updateQuoteItemQuantity } from './quotes'

beforeEach(() => {
  ctx.price = 1000
  ctx.db = createFakeDb({
    services: [{ id: 's1', name: 'Cambio de canilla' }],
    quotes: [{ id: 'q1', user_id: 'u1', customer_id: null, number: 1, status: 'accepted', total: 0 }],
  })
})

describe('9. los presupuestos conservan sus valores históricos', () => {
  it('guarda precio y descripción del momento en que se agregó el ítem', async () => {
    await addQuoteItem('q1', 's1', 2)
    expect(ctx.db.tables.quote_items[0]).toMatchObject({ description: 'Cambio de canilla', unit_price: 1000, subtotal: 2000, quantity: 2 })
    expect(ctx.db.tables.quotes[0].total).toBe(2000)
  })
  it('si luego cambia el precio de lista o el nombre del servicio, el presupuesto anterior no cambia', async () => {
    await addQuoteItem('q1', 's1', 2)
    ctx.price = 1500                                   // nueva versión de la lista de precios
    ctx.db.tables.services[0].name = 'Cambio de grifería' // el admin renombra el servicio
    const item = ctx.db.tables.quote_items[0]
    expect(item).toMatchObject({ description: 'Cambio de canilla', unit_price: 1000, subtotal: 2000 })
    // cambiar la cantidad reutiliza el precio guardado, no el vigente
    await updateQuoteItemQuantity(item.id, 'q1', 3)
    expect(ctx.db.tables.quote_items[0]).toMatchObject({ unit_price: 1000, subtotal: 3000 })
    expect(ctx.db.tables.quotes[0].total).toBe(3000)
  })
  it('un presupuesto nuevo sí toma el precio vigente', async () => {
    await addQuoteItem('q1', 's1', 1)
    ctx.price = 1500
    await addQuoteItem('q1', 's1', 1)
    expect(ctx.db.tables.quote_items.map((i) => i.unit_price)).toEqual([1000, 1500])
  })
  it('sin la migración 0022, igual se puede presupuestar (sin snapshot de nombre)', async () => {
    ctx.db.legacySchema = true
    const r = await addQuoteItem('q1', 's1', 1)
    expect(r).toBeUndefined()
    expect(ctx.db.tables.quote_items).toHaveLength(1)
    expect(ctx.db.tables.quote_items[0].unit_price).toBe(1000)
  })
})

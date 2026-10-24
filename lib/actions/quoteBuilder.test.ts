import { describe, it, expect, vi, beforeEach } from 'vitest'

// Cliente falso que REGISTRA cada llamada (tabla, operaciones y filtros) y responde lo que cada prueba configure.
type Call = { table: string; ops: [string, ...any[]][] }
const ctx = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  denied: null as null | { error: string },
  calls: [] as any[],
  rpcCalls: [] as any[],
  rpcResult: { data: { id: 'q1', number: 4, total: 100, created: true }, error: null } as any,
  tables: {} as Record<string, (c: any) => { data: any; error: any; count?: number }>,
}))

function builder(table: string) {
  const call: Call = { table, ops: [] }
  ctx.calls.push(call)
  const q: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (ok: any, bad: any) => Promise.resolve((ctx.tables[table] ?? (() => ({ data: [], error: null })))(call)).then(ok, bad)
      }
      return (...args: any[]) => {
        call.ops.push([prop, ...args])
        if (prop === 'maybeSingle' || prop === 'single') return Promise.resolve((ctx.tables[table] ?? (() => ({ data: null, error: null })))(call))
        return q
      }
    },
  })
  return q
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: ctx.user } }) },
    from: (t: string) => builder(t),
    rpc: async (name: string, args: any) => { ctx.rpcCalls.push([name, args]); return ctx.rpcResult },
  }),
}))
vi.mock('@/lib/services/access', () => ({ requireFullAccess: async () => ctx.denied }))
vi.mock('@/lib/services/userTrades', () => ({ getMyEnabledTradeIds: async () => ['t1'] }))
vi.mock('@/lib/services/pricingBatch', () => ({ getPricingBatch: async () => new Map([['s1', { personalPrice: 777 }]]) }))

import { fetchLinkableQuotes, linkQuoteToJob, reopenQuote, saveQuote, searchConcepts, searchCustomers } from './quoteBuilder'
import type { QuoteLine } from '@/lib/quotes'

const REQ = '11111111-2222-4333-8444-555555555555'
const line = (o: Partial<QuoteLine> = {}): QuoteLine => ({ key: 'k', source: 'custom', serviceId: null, catalogItemId: null, description: 'Flete', unitLabel: null, quantity: 2, unitPrice: 50, ...o })
const input = (o: any = {}) => ({ requestId: REQ, quoteId: null, customerId: 'c1', notes: '', lines: [line()], ...o })
const find = (table: string) => ctx.calls.filter((c: Call) => c.table === table)
const hasOp = (c: Call, op: string, ...args: any[]) => c.ops.some(([o, ...a]: any[]) => o === op && args.every((x, i) => a[i] === x))

beforeEach(() => {
  ctx.user = { id: 'u1' }; ctx.denied = null; ctx.calls = []; ctx.rpcCalls = []; ctx.tables = {}
  ctx.rpcResult = { data: { id: 'q1', number: 4, total: 100, created: true }, error: null }
})

describe('saveQuote', () => {
  it('llama a save_quote con la clave de idempotencia y SIN user_id ni totales', async () => {
    const r = await saveQuote(input())
    expect(r.data).toMatchObject({ id: 'q1', number: 4, total: 100, created: true, linked: false })
    const [name, args] = ctx.rpcCalls[0]
    expect(name).toBe('save_quote')
    expect(args.p_request_id).toBe(REQ)
    expect(JSON.stringify(args)).not.toMatch(/user_id|total|subtotal/)
    expect(args.p_items[0]).toMatchObject({ description: 'Flete', quantity: 2, unit_price: 50 })
  })
  it('sin sesión o sin acceso (suscripción): no llega a la base', async () => {
    ctx.user = null
    expect(await saveQuote(input())).toEqual({ error: 'No autenticado' })
    ctx.user = { id: 'u1' }; ctx.denied = { error: 'Suscripción vencida' }
    expect(await saveQuote(input())).toEqual({ error: 'Suscripción vencida' })
    expect(ctx.rpcCalls).toHaveLength(0)
  })
  it('valida en el servidor aunque el navegador mande datos inválidos', async () => {
    const r = await saveQuote(input({ lines: [line({ quantity: 0 }), line({ key: 'z', description: ' ' })] }))
    expect(r.error).toBeTruthy()
    expect(r.fieldErrors?.k.quantity).toBeTruthy()
    expect(r.fieldErrors?.z.description).toBeTruthy()
    expect(ctx.rpcCalls).toHaveLength(0)
    expect((await saveQuote(input({ requestId: 'no-es-uuid' }))).error).toMatch(/inválida/)
    expect((await saveQuote(input({ lines: 'hack' as any }))).data?.id).toBe('q1') // lines no-array se trata como vacío (borrador sin líneas)
  })
  it('mensajes en español de la base (P0001) se muestran tal cual; otros errores, genéricos', async () => {
    ctx.rpcResult = { data: null, error: { code: 'P0001', message: 'El presupuesto ya no es un borrador: no se puede modificar.' } }
    expect((await saveQuote(input())).error).toMatch(/ya no es un borrador/)
    ctx.rpcResult = { data: null, error: { code: 'XX000', message: 'detalle interno secreto' } }
    const r = await saveQuote(input())
    expect(r.error).not.toMatch(/secreto/)
    ctx.rpcResult = { data: null, error: { code: 'PGRST202', message: 'x' } }
    expect((await saveQuote(input())).error).toMatch(/actualización de la base de datos/)
  })
  it('registra actividad del cliente solo al CREAR (no en cada guardado)', async () => {
    await saveQuote(input())
    expect(find('client_activity')).toHaveLength(1)
    ctx.calls = []; ctx.rpcResult = { data: { id: 'q1', number: 4, total: 100, created: false }, error: null }
    await saveQuote(input({ quoteId: 'q1' }))
    expect(find('client_activity')).toHaveLength(0)
  })
})

describe('vínculo con la agenda', () => {
  const job = (o: any = {}) => ({ id: 'j1', customer_id: 'c1', quote_id: null, status: 'pending', ...o })
  const setup = (j: any, q: any, updateError: any = null) => {
    ctx.tables.client_jobs = (c) => (hasOp(c, 'update') ? { data: null, error: updateError } : { data: j, error: null })
    ctx.tables.quotes = () => ({ data: q, error: null })
  }
  it('vincula y filtra siempre por user_id', async () => {
    setup(job(), { id: 'q1', customer_id: 'c1' })
    expect(await linkQuoteToJob('j1', 'q1')).toEqual({ ok: true })
    const upd = find('client_jobs').find((c: Call) => hasOp(c, 'update'))!
    expect(hasOp(upd, 'eq', 'user_id', 'u1')).toBe(true)
    expect(upd.ops.find(([o]: any[]) => o === 'update')![1]).toEqual({ quote_id: 'q1', customer_id: 'c1' })
  })
  it('el trabajo sin cliente adopta el del presupuesto', async () => {
    setup(job({ customer_id: null }), { id: 'q1', customer_id: 'c9' })
    await linkQuoteToJob('j1', 'q1')
    const upd = find('client_jobs').find((c: Call) => hasOp(c, 'update'))!
    expect(upd.ops.find(([o]: any[]) => o === 'update')![1]).toMatchObject({ customer_id: 'c9' })
  })
  it('reintentar con el mismo presupuesto es idempotente (no actualiza de nuevo)', async () => {
    setup(job({ quote_id: 'q1' }), { id: 'q1', customer_id: 'c1' })
    expect(await linkQuoteToJob('j1', 'q1')).toEqual({ ok: true })
    expect(find('client_jobs').some((c: Call) => hasOp(c, 'update'))).toBe(false)
  })
  it.each([
    ['otro presupuesto ya vinculado', job({ quote_id: 'otro' }), { id: 'q1', customer_id: 'c1' }, /otro presupuesto/],
    ['clientes distintos', job({ customer_id: 'c1' }), { id: 'q1', customer_id: 'c2' }, /no coincide/],
    ['trabajo con cliente y presupuesto sin cliente', job(), { id: 'q1', customer_id: null }, /Elegí el cliente/],
    ['trabajo cancelado', job({ status: 'cancelled' }), { id: 'q1', customer_id: 'c1' }, /cancelado/],
    ['trabajo ajeno / inexistente', null, { id: 'q1', customer_id: 'c1' }, /No encontramos ese trabajo/],
    ['presupuesto ajeno / inexistente', job(), null, /No encontramos ese presupuesto/],
  ])('rechaza: %s', async (_n, j, q, msg) => {
    setup(j, q)
    const r = await linkQuoteToJob('j1', 'q1')
    expect('error' in r && r.error).toMatch(msg)
    expect(find('client_jobs').some((c: Call) => hasOp(c, 'update'))).toBe(false)
  })
  it('el índice único (presupuesto ya tiene trabajo activo) se traduce a un mensaje claro', async () => {
    setup(job(), { id: 'q1', customer_id: 'c1' }, { code: '23505', message: 'dup' })
    const r = await linkQuoteToJob('j1', 'q1')
    expect('error' in r && r.error).toMatch(/ya está vinculado a otro trabajo/)
  })
  it('guardar con jobId informa si no se pudo vincular, sin perder el presupuesto', async () => {
    setup(job({ quote_id: 'otro' }), { id: 'q1', customer_id: 'c1' })
    const r = await saveQuote(input({ jobId: 'j1' }))
    expect(r.data).toMatchObject({ id: 'q1', linked: false })
    expect(r.data?.linkError).toMatch(/otro presupuesto/)
  })
  it('presupuestos vinculables excluyen los que ya tienen trabajo activo', async () => {
    ctx.tables.quotes = () => ({ data: [{ id: 'a', number: 1, status: 'draft', total: 1, customers: { name: 'Ana' } }, { id: 'b', number: 2, status: 'accepted', total: 2, customers: null }], error: null })
    ctx.tables.client_jobs = () => ({ data: [{ quote_id: 'a' }], error: null })
    const r = await fetchLinkableQuotes('c1')
    expect('data' in r && r.data.map((x) => x.id)).toEqual(['b'])
    expect(hasOp(find('quotes')[0], 'eq', 'user_id', 'u1')).toBe(true)
    expect(hasOp(find('quotes')[0], 'eq', 'customer_id', 'c1')).toBe(true)
  })
})

describe('búsquedas', () => {
  it('catálogo propio: solo del usuario y activos, con búsqueda por nombre o categoría y paginado', async () => {
    ctx.tables.catalog_items = () => ({ data: [{ id: 'c1', name: 'Flete', description: null, category: 'Log', unit_label: 'viaje', unit_price: '1500.00' }], error: null, count: 45 })
    const r = await searchConcepts({ scope: 'own', q: '50% off, (x)', page: 2 })
    expect(r).toMatchObject({ total: 45, page: 2, pageSize: 20 })
    const c = find('catalog_items')[0]
    expect(hasOp(c, 'eq', 'user_id', 'u1')).toBe(true)
    expect(hasOp(c, 'eq', 'is_active', true)).toBe(true)
    expect(hasOp(c, 'range', 20, 39)).toBe(true)
    const ors = c.ops.filter(([o]: any[]) => o === 'or').map((x: any[]) => x[1] as string)
    expect(ors[0]).toBe('name.ilike.%50\\%%,category.ilike.%50\\%%')   // palabra "50%": comodín escapado
    expect(ors).toHaveLength(3)                                           // una condición por palabra: "50%", "off,", "(x)"
    for (const f of ors) expect(f.replace(/^name\.ilike\.|,category\.ilike\./g, '')).not.toMatch(/[(),"]/)  // nada que rompa el filtro
    if ('items' in r) expect(r.items[0]).toMatchObject({ kind: 'own', price: 1500 })
  })
  it('lista de precios: usa precios personales del lote y solo oficios habilitados', async () => {
    ctx.tables.services = () => ({ data: [{ id: 's1', name: 'Canilla', unit_label: 'Trabajo', categories: { name: 'Plomería', trade_id: 't1' } }, { id: 's2', name: 'Sin precio', unit_label: 'x', categories: { name: 'P', trade_id: 't1' } }], error: null })
    const r = await searchConcepts({ scope: 'service', q: 'canilla' })
    expect('items' in r && r.items).toEqual([{ kind: 'service', id: 's1', name: 'Canilla', description: null, category: 'Plomería', unit: 'Trabajo', price: 777 }])
    expect(find('services')[0].ops.some(([o, c, v]: any[]) => o === 'in' && c === 'categories.trade_id' && v[0] === 't1')).toBe(true)
  })
  it('clientes: solo los del usuario', async () => {
    ctx.tables.customers = () => ({ data: [{ id: 'k', name: 'Ana', phone: null, address: null }], error: null })
    await searchCustomers('ana')
    expect(hasOp(find('customers')[0], 'eq', 'user_id', 'u1')).toBe(true)
  })
  it('errores de base: mensaje claro, sin detalles internos', async () => {
    ctx.tables.catalog_items = () => ({ data: null, error: { code: 'XX', message: 'interno' } })
    const r = await searchConcepts({ scope: 'own', q: '' })
    expect(r).toEqual({ error: 'No se pudo cargar tu catálogo.' })
  })
})

describe('reabrir presupuesto', () => {
  it('solo enviados/rechazados del propio usuario', async () => {
    ctx.tables.quotes = () => ({ data: [{ id: 'q1' }], error: null })
    expect(await reopenQuote('q1')).toEqual({ ok: true })
    const c = find('quotes')[0]
    expect(hasOp(c, 'eq', 'user_id', 'u1')).toBe(true)
    expect(c.ops.some(([o, col, v]: any[]) => o === 'in' && col === 'status' && v.join() === 'sent,rejected')).toBe(true)
    ctx.tables.quotes = () => ({ data: [], error: null })
    expect('error' in (await reopenQuote('q1'))).toBe(true)
  })
})

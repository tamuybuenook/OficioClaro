import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctx = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null, denied: null as null | { error: string }, calls: [] as any[], result: { data: null as any, error: null as any, count: 0 } }))
function builder(table: string) {
  const call = { table, ops: [] as any[] }
  ctx.calls.push(call)
  const q: any = new Proxy({}, { get(_t, prop: string) {
    if (prop === 'then') return (ok: any, bad: any) => Promise.resolve(ctx.result).then(ok, bad)
    return (...a: any[]) => { call.ops.push([prop, ...a]); return prop === 'single' || prop === 'maybeSingle' ? Promise.resolve(ctx.result) : q }
  } })
  return q
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: ctx.user } }) }, from: (t: string) => builder(t) }) }))
vi.mock('@/lib/services/access', () => ({ requireFullAccess: async () => ctx.denied }))

import { createCatalogItem, listOwnCatalog, setCatalogItemActive, updateCatalogItem } from './catalogItems'

const input = { name: 'Flete', description: '', category: '', unit_label: 'viaje', price: '1500' }
const row = { id: 'c1', name: 'Flete', description: null, category: null, unit_label: 'viaje', unit_price: 1500, is_active: true, updated_at: 'x' }
const op = (i: number, name: string) => ctx.calls[i].ops.find(([o]: any[]) => o === name)

beforeEach(() => { ctx.user = { id: 'u1' }; ctx.denied = null; ctx.calls = []; ctx.result = { data: row, error: null, count: 1 } })

describe('catálogo propio (acciones)', () => {
  it('crear: NUNCA envía user_id (lo fija la base), y devuelve el concepto', async () => {
    const r = await createCatalogItem(input)
    expect('data' in r && r.data.id).toBe('c1')
    const payload = op(0, 'insert')[1]
    expect(Object.keys(payload).sort()).toEqual(['category', 'description', 'name', 'unit_label', 'unit_price'])
    expect(JSON.stringify(payload)).not.toContain('u1')
  })
  it('crear: valida antes de tocar la base', async () => {
    const r = await createCatalogItem({ ...input, name: '', price: 'x' })
    expect('error' in r && r.fieldErrors).toMatchObject({ name: expect.any(String), price: expect.any(String) })
    expect(ctx.calls).toHaveLength(0)
  })
  it('crear: nombre repetido (23505) = error en el campo, sin detalles internos', async () => {
    ctx.result = { data: null, error: { code: '23505', message: 'catalog_items_unique_active_name' }, count: 0 }
    const r = await createCatalogItem(input)
    expect('error' in r && r.error).toBe('Ya tenés un concepto activo con ese nombre.')
    expect('fieldErrors' in r && r.fieldErrors?.name).toBeTruthy()
  })
  it('editar y desactivar: filtran por id Y por user_id', async () => {
    await updateCatalogItem('c1', input)
    expect(ctx.calls[0].ops.some(([o, c, v]: any[]) => o === 'eq' && c === 'user_id' && v === 'u1')).toBe(true)
    await setCatalogItemActive('c1', false)
    expect(ctx.calls[1].ops.some(([o, c, v]: any[]) => o === 'eq' && c === 'user_id' && v === 'u1')).toBe(true)
    expect(op(1, 'update')[1]).toEqual({ is_active: false })
  })
  it('editar un concepto ajeno/inexistente (0 filas): "No encontramos ese concepto"', async () => {
    ctx.result = { data: null, error: null, count: 0 }
    const r = await updateCatalogItem('ajeno', input)
    expect('error' in r && r.error).toMatch(/No encontramos/)
  })
  it('listar: solo del usuario, activos por defecto, paginado y con búsqueda por nombre o categoría', async () => {
    ctx.result = { data: [row], error: null, count: 61 }
    const r = await listOwnCatalog({ q: 'flete', page: 3 })
    expect(r).toMatchObject({ total: 61, page: 3, pageSize: 30 })
    const ops = ctx.calls[0].ops
    expect(ops.some(([o, c, v]: any[]) => o === 'eq' && c === 'user_id' && v === 'u1')).toBe(true)
    expect(ops.some(([o, c, v]: any[]) => o === 'eq' && c === 'is_active' && v === true)).toBe(true)
    expect(ops.some(([o, a, b]: any[]) => o === 'range' && a === 60 && b === 89)).toBe(true)
    await listOwnCatalog({ includeInactive: true })
    expect(ctx.calls[1].ops.some(([o, c]: any[]) => o === 'eq' && c === 'is_active')).toBe(false)
  })
  it('sin sesión o con acceso bloqueado no consulta nada', async () => {
    ctx.user = null
    expect(await createCatalogItem(input)).toEqual({ error: 'No autenticado' })
    ctx.user = { id: 'u1' }; ctx.denied = { error: 'bloqueado' }
    expect(await listOwnCatalog({})).toEqual({ error: 'bloqueado' })
    expect(ctx.calls).toHaveLength(0)
  })
  it('falta la migración: mensaje claro, no un error técnico', async () => {
    ctx.result = { data: null, error: { code: '42P01', message: 'relation does not exist' }, count: 0 }
    const r = await createCatalogItem(input)
    expect('error' in r && r.error).toMatch(/actualización de la base de datos/)
  })
})

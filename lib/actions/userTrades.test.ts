import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { enabled: [] as string[], limit: 1 as number | null, valid: ['a', 'b', 'c'], inserted: null as any }
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/services/userTrades', () => ({ getMyEnabledTradeIds: async () => state.enabled, getMyTradeLimit: async () => state.limit }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => t === 'trades'
      ? { select: () => ({ in: (_c: string, ids: string[]) => ({ eq: async () => ({ data: ids.filter((i) => state.valid.includes(i)).map((id) => ({ id })), error: null }) }) }) }
      : { insert: async (rows: any) => { state.inserted = rows; return { error: null } } },
  }),
}))

import { confirmTrades, enableTrade, disableTrade } from './userTrades'

beforeEach(() => { state.enabled = []; state.limit = 1; state.inserted = null })

describe('confirmTrades (reglas en el servidor)', () => {
  it('guarda la selección dentro del límite', async () => {
    expect(await confirmTrades(['a'])).toEqual({ data: true })
    expect(state.inserted).toEqual([{ user_id: 'u1', trade_id: 'a' }])
  })
  it('rechaza más oficios que el límite del plan', async () => {
    const r: any = await confirmTrades(['a', 'b'])
    expect(r.error).toMatch(/hasta 1/); expect(state.inserted).toBeNull()
  })
  it('no permite QUITAR oficios ya confirmados', async () => {
    state.enabled = ['a', 'b']; state.limit = null
    const r: any = await confirmTrades(['a', 'c'])
    expect(r.error).toMatch(/no se pueden quitar/); expect(state.inserted).toBeNull()
  })
  it('Básico -> Medium: suma solo los oficios nuevos hasta el nuevo límite, sin duplicar', async () => {
    state.enabled = ['a']; state.limit = 3
    expect(await confirmTrades(['a', 'b', 'c'])).toEqual({ data: true })
    expect(state.inserted).toEqual([{ user_id: 'u1', trade_id: 'b' }, { user_id: 'u1', trade_id: 'c' }])
  })
  it('no supera el límite al ampliar, e informa cuánto queda', async () => {
    state.enabled = ['a']; state.limit = 2
    const r: any = await confirmTrades(['a', 'b', 'c'])
    expect(r.error).toMatch(/podés agregar 1 más/); expect(state.inserted).toBeNull()
  })
  it('con el cupo completo (o tras bajar de plan) no deja agregar y no borra nada', async () => {
    state.enabled = ['a', 'b', 'c']; state.limit = 1
    expect(((await confirmTrades(['a', 'b', 'c', 'x'])) as any).error).toMatch(/ya los tenés/)
    expect(state.inserted).toBeNull()
  })
  it('reenviar lo mismo (sin nuevos) no inserta nada', async () => {
    state.enabled = ['a']; state.limit = null
    expect(((await confirmTrades(['a'])) as any).error).toMatch(/No elegiste oficios nuevos/); expect(state.inserted).toBeNull()
  })
  it('suscripción vencida: ni siquiera con cupo se agregan oficios', async () => {
    state.enabled = ['a']; state.limit = 0
    expect(((await confirmTrades(['a', 'b'])) as any).error).toMatch(/suscripción/)
  })
  it('sin suscripción activa (límite 0) no permite elegir', async () => {
    state.limit = 0
    expect(((await confirmTrades(['a'])) as any).error).toMatch(/suscripción/)
  })
  it('rechaza oficios inexistentes/inactivos y listas vacías; sin límite acepta varios y deduplica', async () => {
    expect(((await confirmTrades(['zzz'])) as any).error).toMatch(/no está disponible/)
    expect(((await confirmTrades([])) as any).error).toMatch(/al menos un oficio/)
    state.limit = null
    await confirmTrades(['a', 'a', 'b'])
    expect(state.inserted).toHaveLength(2)
  })
  it('alta y baja individuales ya no funcionan (no se puede eludir la confirmación)', async () => {
    expect(((await enableTrade('a')) as any).error).toBeTruthy()
    expect(((await disableTrade('a')) as any).error).toMatch(/no se pueden quitar/)
  })
})

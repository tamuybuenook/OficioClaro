import { describe, it, expect, vi, beforeEach } from 'vitest'
const st: { res: { data: any; error: any }; calls: any[] } = { res: { data: true, error: null }, calls: [] }
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: async (n: string, a: any) => { st.calls.push({ n, a }); return st.res } }) }))
import { dismissNotification } from './notifications'

const ID = '11111111-1111-4111-8111-111111111111'
beforeEach(() => { st.calls = []; st.res = { data: true, error: null } })

describe('dismissNotification', () => {
  it('llama a la función de la base con el id', async () => {
    expect(await dismissNotification(ID)).toEqual({ ok: true })
    expect(st.calls).toEqual([{ n: 'dismiss_notification', a: { p_id: ID } }])
  })
  it('la base dice que no (ajeno / no descartable / ya descartado): ok false', async () => {
    st.res = { data: false, error: null }; expect(await dismissNotification(ID)).toEqual({ ok: false })
  })
  it('error de la base: ok false, sin lanzar', async () => {
    st.res = { data: null, error: { code: 'XX000' } }; expect(await dismissNotification(ID)).toEqual({ ok: false })
  })
  it('id inválido: ni siquiera consulta la base', async () => {
    for (const bad of ['', 'x', "1' or '1'='1", null as any, 5 as any]) expect(await dismissNotification(bad)).toEqual({ ok: false })
    expect(st.calls).toHaveLength(0)
  })
})

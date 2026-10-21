import { describe, it, expect, vi, beforeEach } from 'vitest'

const st = { denied: true, touched: 0 }
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/services/access', () => ({ requireFullAccess: async () => (st.denied ? { error: 'BLOQUEADO' } : null) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    st.touched += 1
    const b: any = { select: () => b, insert: () => b, update: () => b, delete: () => b, eq: () => b, single: async () => ({ data: { id: 'c1' }, error: null }), then: (ok: any) => Promise.resolve({ data: [], error: null }).then(ok) }
    return { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: () => b }
  },
}))

import { createCustomer, updateCustomer, deleteCustomer } from './customers'
import { updateMyProfile } from './profile'
import { setMyUnitValue } from './userPricing'
import { fetchAgendaCustomers } from './agenda'

const fd = new FormData(); fd.set('name', 'Ana')
beforeEach(() => { st.denied = true; st.touched = 0 })

describe('usuario bloqueado: ninguna acción de uso toca la base', () => {
  it('clientes', async () => {
    expect(await createCustomer(fd)).toEqual({ error: 'BLOQUEADO' })
    expect(await updateCustomer('c1', fd)).toEqual({ error: 'BLOQUEADO' })
    expect(await deleteCustomer('c1')).toEqual({ error: 'BLOQUEADO' })
  })
  it('perfil, precios y agenda', async () => {
    expect(await updateMyProfile(fd)).toEqual({ error: 'BLOQUEADO' })
    expect(await setMyUnitValue(100)).toEqual({ error: 'BLOQUEADO' })
    expect(await fetchAgendaCustomers()).toEqual({ error: 'BLOQUEADO' })
    expect(st.touched).toBe(0)
  })
  it('con acceso completo la acción sigue su curso', async () => {
    st.denied = false
    const r: any = await createCustomer(fd)
    expect(r.error).toBeUndefined(); expect(st.touched).toBeGreaterThan(0)
  })
})

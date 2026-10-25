import { describe, expect, it, vi, beforeEach } from 'vitest'

// Captura el texto del select() y permite simular un error de la base.
const st = { eqs: [] as [string, string][], selects: [] as string[], error: null as null | { code: string; message: string }, row: null as any }
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      const chain: any = {
        select: (s: string) => { st.selects.push(s); return chain },
        eq: (c: string, v: string) => { st.eqs.push([c, v]); return chain }, order: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: st.error ? null : st.row, error: st.error }),
        then: (res: any) => res({ data: st.error ? null : [], error: st.error }),
      }
      return chain
    },
  }),
}))

import { getMySubscription } from './subscriptions'
import { getMyPayments } from './payments'

beforeEach(() => { st.eqs = []; st.selects = []; st.error = null; st.row = { id: 's1', plans: { name: 'Trimestral' } } })

describe('lectura de la suscripción y los pagos del usuario', () => {
  it('pide el plan con la pista plans!plan_id (no la relación ambigua)', async () => {
    const sub = await getMySubscription()
    expect(st.selects[0]).toContain('plans!plan_id(*)')
    expect(st.selects[0]).not.toMatch(/(^|[^!\w])plans\(/)
    expect((sub as any).plans.name).toBe('Trimestral')
    await getMyPayments()
    expect(st.selects[1]).toContain('subscriptions!inner(user_id, plan_id, plans!plan_id(name))')
  })
  it('los pagos se piden SOLO del usuario autenticado (un admin no debe ver pagos ajenos en su panel de usuario)', async () => {
    await getMyPayments()
    expect(st.eqs).toContainEqual(['subscriptions.user_id', 'u1'])
  })
  it('un error de la base NO se oculta dentro del servicio: se propaga (la página lo registra)', async () => {
    st.error = { code: 'PGRST201', message: 'más de una relación' }
    await expect(getMySubscription()).rejects.toMatchObject({ code: 'PGRST201' })
    await expect(getMyPayments()).rejects.toMatchObject({ code: 'PGRST201' })
  })
})

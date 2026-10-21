import { describe, expect, it, vi, beforeEach } from 'vitest'

const st = { role: 'admin', rpcError: null as null | { message: string }, rpcCalls: [] as any[], inserts: [] as any[], allow: true }
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ allow: async () => st.allow, RATE_MESSAGE: 'rate' }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc: async (fn: string, args: any) => { st.rpcCalls.push([fn, args]); return { data: st.rpcError ? null : { outcome: 'ok' }, error: st.rpcError } },
    from: (t: string) => {
      const chain: any = {
        select: () => chain, eq: () => chain, single: async () => ({ data: t === 'profiles' ? { role: st.role } : null }),
        insert: (v: any) => { st.inserts.push([t, v]); return chain },
        then: (res: any) => res({ data: null, error: null }),
      }
      return chain
    },
  }),
}))

import { reconcilePayment, reportTransferPayment } from './payments'

beforeEach(() => { st.role = 'admin'; st.rpcError = null; st.rpcCalls = []; st.inserts = []; st.allow = true })

describe('reconcilePayment (delegada a la función SQL atómica)', () => {
  it('un usuario común ni siquiera llega a la base', async () => {
    st.role = 'user'
    expect(((await reconcilePayment('p1', 'reconciled')) as any).error).toMatch(/administrador/)
    expect(st.rpcCalls).toHaveLength(0)
  })
  it('admin: una sola llamada RPC transaccional con los parámetros validados', async () => {
    await reconcilePayment('p1', 'reconciled', 'nota')
    expect(st.rpcCalls).toEqual([['reconcile_transfer_payment', { p_payment_id: 'p1', p_status: 'reconciled', p_notes: 'nota' }]])
    expect(st.inserts).toHaveLength(0) // ya no hay escrituras sueltas desde el servidor de la app
  })
  it('doble ejecución / carrera / MP / fallo transaccional: el error de la base se informa y no hay efectos locales', async () => {
    for (const m of ['ERROR:  Ese pago ya fue resuelto.', 'Solo se concilian transferencias manualmente.', 'fallo simulado']) {
      st.rpcError = { message: m }
      const r: any = await reconcilePayment('p1', 'reconciled')
      expect(r.error).toBe(m.replace(/^ERROR:\s*/, ''))
    }
    expect(st.inserts).toHaveLength(0)
  })
  it('estado inválido: no llega a la base', async () => {
    expect(((await reconcilePayment('p1', 'approved' as any)) as any).error).toMatch(/inválido/)
    expect(st.rpcCalls).toHaveLength(0)
  })
})

describe('reportTransferPayment', () => {
  const fd = (o: Record<string, string>) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.set(k, v)); return f }
  it('rechaza montos inválidos, comprobantes no http y exceso de frecuencia', async () => {
    for (const amount of ['NaN', '-5', '0', 'abc', '999999999999']) expect(((await reportTransferPayment('s1', fd({ amount }))) as any).error).toMatch(/Monto/)
    expect(((await reportTransferPayment('s1', fd({ amount: '100', proof_url: 'javascript:alert(1)' }))) as any).error).toMatch(/enlace/)
    st.allow = false
    expect(((await reportTransferPayment('s1', fd({ amount: '100' }))) as any).error).toBe('rate')
    expect(st.inserts).toHaveLength(0)
  })
})

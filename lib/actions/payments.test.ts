import { describe, expect, it, vi, beforeEach } from 'vitest'

const st = { role: 'admin', noUser: false, rpcData: { outcome: 'ok' } as any, rpcError: null as null | { message: string }, rpcCalls: [] as any[], inserts: [] as any[], allow: true }
const revalidate = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath: revalidate }))
vi.mock('@/lib/rate-limit', () => ({ allow: async () => st.allow, RATE_MESSAGE: 'rate' }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: st.noUser ? null : { id: 'u1' } } }) },
    rpc: async (fn: string, args: any) => { st.rpcCalls.push([fn, args]); return { data: st.rpcError ? null : st.rpcData, error: st.rpcError } },
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

beforeEach(() => { revalidate.mockClear(); st.noUser = false; st.rpcData = { outcome: 'ok' }; st.role = 'admin'; st.rpcError = null; st.rpcCalls = []; st.inserts = []; st.allow = true })

const PID = '11111111-2222-4333-8444-555555555555'
const ok = (o: Partial<Parameters<typeof reconcilePayment>[0]> = {}) => reconcilePayment({ paymentId: PID, decision: 'reconciled', confirmFundsReceived: true, ...o })

describe('reconcilePayment (delegada a la función SQL atómica)', () => {
  it('un usuario común ni siquiera llega a la base', async () => {
    st.role = 'user'
    expect(((await ok()) as any).error).toMatch(/administrador/)
    expect(((await ok({ decision: 'rejected', notes: 'no llegó el dinero' })) as any).error).toMatch(/administrador/)
    expect(st.rpcCalls).toHaveLength(0)
  })
  it('sin sesión no llega a la base', async () => {
    st.noUser = true
    expect(((await ok()) as any).error).toBe('No autenticado')
    expect(st.rpcCalls).toHaveLength(0)
  })
  it('aprobar: una sola llamada RPC transaccional; devuelve el nuevo vencimiento', async () => {
    st.rpcData = { outcome: 'ok', status: 'reconciled', end_date: '2026-12-01' }
    const r = await ok({ notes: ' ingresó 10:32 ' })
    expect(r).toEqual({ ok: true, status: 'reconciled', endDate: '2026-12-01' })
    expect(st.rpcCalls).toEqual([['reconcile_transfer_payment', { p_payment_id: PID, p_status: 'reconciled', p_notes: 'ingresó 10:32' }]])
    expect(st.inserts).toHaveLength(0) // ya no hay escrituras sueltas desde el servidor de la app
  })
  it('aprobar SIN confirmar que el dinero ingresó: no llega a la base (ni con truthy no estricto)', async () => {
    for (const c of [undefined, false, 'true' as any, 1 as any]) {
      expect(((await ok({ confirmFundsReceived: c })) as any).error).toMatch(/confirmar que el dinero ingresó/)
    }
    expect(st.rpcCalls).toHaveLength(0)
  })
  it('rechazar exige motivo; con motivo llega a la base y no pide confirmar ingreso', async () => {
    for (const notes of [undefined, '', '   ', 'no']) {
      expect(((await ok({ decision: 'rejected', notes, confirmFundsReceived: false })) as any).error).toMatch(/motivo del rechazo/)
    }
    expect(st.rpcCalls).toHaveLength(0)
    const r = await ok({ decision: 'rejected', notes: 'No figura en el banco', confirmFundsReceived: false })
    expect(r).toMatchObject({ ok: true, status: 'rejected', endDate: null })
    expect(st.rpcCalls[0][1]).toEqual({ p_payment_id: PID, p_status: 'rejected', p_notes: 'No figura en el banco' })
  })
  it('el motivo se recorta a 500 caracteres', async () => {
    await ok({ decision: 'rejected', notes: 'x'.repeat(900) })
    expect(st.rpcCalls[0][1].p_notes).toHaveLength(500)
  })
  it('doble ejecución / carrera / MP / fallo transaccional: el error de la base se informa y no hay efectos locales', async () => {
    for (const m of ['ERROR:  Ese pago ya fue resuelto.', 'Solo se concilian transferencias manualmente.', 'fallo simulado']) {
      st.rpcError = { message: m }
      const r: any = await ok()
      expect(r.error).toBe(m.replace(/^ERROR:\s*/, ''))
      expect(r.ok).toBeUndefined()
    }
    expect(st.inserts).toHaveLength(0)
  })
  it('un fallo no revalida pantallas como si hubiera cambiado algo', async () => {
    st.rpcError = { message: 'fallo' }
    await ok()
    expect(revalidate).not.toHaveBeenCalled()
    st.rpcError = null
    await ok()
    expect(revalidate).toHaveBeenCalledWith(`/admin/facturacion/pagos/${PID}`)
  })
  it('estado o identificador inválidos: no llegan a la base', async () => {
    expect(((await ok({ decision: 'approved' as any })) as any).error).toMatch(/inválido/)
    for (const id of ['p1', '', "1'; drop table payments;--", undefined as any]) expect(((await ok({ paymentId: id })) as any).error).toMatch(/inválido/)
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

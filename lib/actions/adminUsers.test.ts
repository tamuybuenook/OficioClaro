import { describe, expect, it, vi, beforeEach } from 'vitest'

const UID = '22222222-2222-2222-2222-222222222222'
const PID = '11111111-1111-1111-1111-111111111111'
const SID = '33333333-3333-3333-3333-333333333333'
const st = {
  admin: true as boolean, existingSub: { id: SID } as { id: string } | null,
  windDown: { allConfirmed: true } as any, windDownThrows: null as null | Error,
  check: { ok: true, cancelledPreapprovals: [] } as any, checkThrows: null as null | Error,
  calls: [] as any[], authDeletes: [] as string[], authDeleteError: null as null | { message: string }, updates: [] as any[], inserts: [] as any[],
}
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/auth/assert-admin', () => ({
  cleanDbError: (m: string) => m,
  getAdminContext: async () => {
    if (!st.admin) return { error: 'Solo un administrador puede realizar esta acción.' }
    const chain: any = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: st.existingSub }), update: (v: any) => { st.updates.push(v); return chain }, insert: (v: any) => { st.inserts.push(v); return chain }, then: (r: any) => r({ error: null }) }
    return { supabase: { from: () => chain }, user: { id: 'admin-1' } }
  },
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ auth: { admin: { deleteUser: async (id: string) => { st.calls.push('auth.deleteUser'); st.authDeletes.push(id); return { error: st.authDeleteError } } } } }) }))
vi.mock('@/lib/mercadopago/config', () => ({ getMpConfig: () => ({ accessToken: 'x', webhookSecret: 'y', env: 'test', appUrl: 'https://x' }) }))
vi.mock('@/lib/mercadopago/client', () => ({ createMpClient: () => ({ request: async () => ({}) }) }))
vi.mock('@/lib/mercadopago/store', () => ({ createSupabaseMpStore: () => ({}) }))
vi.mock('@/lib/mercadopago/lifecycle', () => ({
  unavailableMp: {},
  windDownSubscription: async (_d: any, a: any) => { st.calls.push(['windDown', a]); if (st.windDownThrows) throw st.windDownThrows; return st.windDown },
  abortUserDeletion: async (_d: any, id: string) => { st.calls.push(['abort', id]) },
  prepareUserDeletion: async (_d: any, a: any) => { st.calls.push(['prepare', a]); if (st.checkThrows) throw st.checkThrows; return st.check },
}))

import { adminSetUserPlan, deleteUser } from './adminUsers'

beforeEach(() => {
  Object.assign(st, { admin: true, existingSub: { id: SID }, windDown: { allConfirmed: true }, windDownThrows: null, check: { ok: true, cancelledPreapprovals: [] }, checkThrows: null, calls: [], authDeletes: [], authDeleteError: null, updates: [], inserts: [] })
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key'
})

describe('adminSetUserPlan', () => {
  it('un usuario no administrador no llega a MP ni a la base', async () => {
    st.admin = false
    expect(((await adminSetUserPlan(UID, PID, 'suspended')) as any).error).toMatch(/administrador/)
    expect(st.calls).toHaveLength(0); expect(st.updates).toHaveLength(0)
  })
  it('datos inválidos se rechazan', async () => {
    expect(((await adminSetUserPlan('x', PID, 'suspended')) as any).error).toBe('Datos inválidos.')
    expect(((await adminSetUserPlan(UID, PID, 'otro' as any)) as any).error).toBe('Datos inválidos.')
  })
  it('suspender: cancela la renovación en MP (flujo con seguimiento) y NO hace un update directo del estado', async () => {
    expect(await adminSetUserPlan(UID, PID, 'suspended')).toBeUndefined()
    expect(st.calls).toEqual([['windDown', { subscriptionId: SID, status: 'suspended', planId: PID, actorId: 'admin-1' }]])
    expect(st.updates).toHaveLength(0)
  })
  it('cancelar también pasa por el flujo con seguimiento', async () => {
    await adminSetUserPlan(UID, PID, 'cancelled')
    expect(st.calls[0][1]).toMatchObject({ status: 'cancelled' })
  })
  it('MP no confirma: el estado local queda aplicado, se informa que la cancelación sigue pendiente', async () => {
    st.windDown = { allConfirmed: false }
    const r: any = await adminSetUserPlan(UID, PID, 'suspended')
    expect(r.warning).toMatch(/no confirmó/); expect(r.error).toBeUndefined()
  })
  it('error de base en el flujo: se informa y no se asume nada', async () => {
    st.windDownThrows = new Error('boom')
    expect(((await adminSetUserPlan(UID, PID, 'suspended')) as any).error).toBe('boom')
  })
  it('activar/prueba no toca Mercado Pago (update directo, como antes)', async () => {
    await adminSetUserPlan(UID, PID, 'active')
    expect(st.calls).toHaveLength(0); expect(st.updates).toEqual([{ plan_id: PID, status: 'active' }])
  })
  it('usuario sin suscripción: se crea (sin nada que cancelar en MP)', async () => {
    st.existingSub = null
    await adminSetUserPlan(UID, PID, 'suspended')
    expect(st.calls).toHaveLength(0); expect(st.inserts).toEqual([{ user_id: UID, plan_id: PID, status: 'suspended' }])
  })
  it('sin clave de servicio no se puede operar sobre renovaciones', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(((await adminSetUserPlan(UID, PID, 'suspended')) as any).error).toMatch(/SERVICE_ROLE/); expect(st.calls).toHaveLength(0)
  })
})

describe('deleteUser', () => {
  it('no administrador: no cancela ni borra', async () => {
    st.admin = false
    expect(((await deleteUser(UID)) as any).error).toMatch(/administrador/); expect(st.calls).toHaveLength(0)
  })
  it('renovación confirmada: primero se prepara/cancela y DESPUÉS se borra la cuenta', async () => {
    expect(await deleteUser(UID)).toBeUndefined()
    expect(st.calls.map((c) => (Array.isArray(c) ? c[0] : c))).toEqual(['prepare', 'auth.deleteUser']); expect(st.authDeletes).toEqual([UID])
  })
  it('cancelación no confirmada: NO se borra nada y se muestra el motivo', async () => {
    st.check = { ok: false, reason: 'pending_cancellation', detail: 'No pudimos confirmar…' }
    expect(((await deleteUser(UID)) as any).error).toMatch(/No pudimos confirmar/); expect(st.authDeletes).toHaveLength(0)
  })
  it('cobros retenidos: NO se borra', async () => {
    st.check = { ok: false, reason: 'held_payments', detail: 'cobros retenidos' }
    expect(((await deleteUser(UID)) as any).error).toMatch(/retenidos/); expect(st.authDeletes).toHaveLength(0)
  })
  it('falla inesperada al verificar: NO se borra', async () => {
    st.checkThrows = new Error('db down')
    expect(((await deleteUser(UID)) as any).error).toMatch(/No se eliminó nada/); expect(st.authDeletes).toHaveLength(0)
  })
  it('falla del borrado de auth (p.ej. la guardia de la base): se informa y se LIBERA la retención de eliminación', async () => {
    st.authDeleteError = { message: 'auth down' }
    expect(((await deleteUser(UID)) as any).error).toBe('auth down')
    expect(st.calls.map((c) => (Array.isArray(c) ? c[0] : c))).toEqual(['prepare', 'auth.deleteUser', 'abort'])
    expect(st.calls[2]).toEqual(['abort', UID])
  })
  it('borrado rechazado por mp:ledger_busy (otra transacción usa el ledger): mensaje de reintento y se libera la retención', async () => {
    st.authDeleteError = { message: 'Database error deleting user: mp:ledger_busy' }
    expect(((await deleteUser(UID)) as any).error).toMatch(/volvé a intentarlo en unos segundos/)
    expect(st.calls[st.calls.length - 1]).toEqual(['abort', UID])
  })
  it('borrado exitoso: la retención NO se libera (la cuenta ya no existe)', async () => {
    await deleteUser(UID)
    expect(st.calls.some((c) => Array.isArray(c) && c[0] === 'abort')).toBe(false)
  })
  it('id inválido o sin clave de servicio: no hace nada', async () => {
    expect(((await deleteUser('x')) as any).error).toBe('Datos inválidos.')
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(((await deleteUser(UID)) as any).error).toMatch(/SERVICE_ROLE/); expect(st.calls).toHaveLength(0)
  })
})

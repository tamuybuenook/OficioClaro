import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { syncNotifications } from './sync'

type Res = { data: any; error: any }
const db: Record<string, Res> = {}
const rpcCalls: any[] = []
let rpcResult: Res = { data: { created: 1, reopened: 0, resolved: 0 }, error: null }
const fake: any = {
  from: (table: string) => {
    const b: any = { select: () => b, eq: () => b, order: () => b, limit: () => b, maybeSingle: async () => db[table], then: (ok: any, ko: any) => Promise.resolve(db[table]).then(ok, ko) }
    return b
  },
  rpc: async (name: string, args: any) => { rpcCalls.push({ name, args }); return rpcResult },
}
const ok = (data: any): Res => ({ data, error: null })
const sub = (o: Record<string, any> = {}) => ok({ id: 's1', status: 'past_due', end_date: '2026-11-12', mp_status: null, cancelled_at: null, plans: { max_trades: 3 }, ...o })

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T15:00:00Z')) // 10/11/2026 en Argentina
  vi.spyOn(console, 'error').mockImplementation(() => {})
  rpcCalls.length = 0; rpcResult = { data: { created: 1, reopened: 0, resolved: 0 }, error: null }
  db.profiles = ok({ role: 'user' }); db.subscriptions = sub(); db.app_settings = ok([{ key: 'notice_days', value: 5 }])
  db.payments = ok(null); db.notifications = ok([])
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('syncNotifications', () => {
  it('cobro fallido: envía el aviso deseado a la base', async () => {
    const r = await syncNotifications('u1', fake)
    expect(r).toMatchObject({ ok: true, skipped: false, desired: 1, created: 1 })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('sync_notifications'); expect(rpcCalls[0].args.p_user_id).toBe('u1')
    expect(rpcCalls[0].args.p_desired[0]).toMatchObject({ kind: 'payment_failed', dedupe_key: 'payment_failed:s1:2026-11-12', severity: 'warning', subscription_id: 's1' })
  })
  it('si la base ya está al día, no escribe (ahorra una llamada por carga de página)', async () => {
    db.notifications = ok([{ dedupe_key: 'payment_failed:s1:2026-11-12' }])
    expect(await syncNotifications('u1', fake)).toMatchObject({ ok: true, skipped: true, desired: 1 })
    expect(rpcCalls).toHaveLength(0)
  })
  it('lo que ya no corresponde se resuelve (lista vacía) cuando hay abiertos', async () => {
    db.subscriptions = sub({ status: 'active', end_date: '2026-12-30' }); db.notifications = ok([{ dedupe_key: 'payment_failed:s1:2026-11-12' }])
    await syncNotifications('u1', fake)
    expect(rpcCalls[0].args.p_desired).toEqual([])
  })
  it('sin avisos abiertos ni deseados: no hace nada', async () => {
    db.subscriptions = sub({ status: 'active', end_date: '2026-12-30' })
    expect(await syncNotifications('u1', fake)).toMatchObject({ ok: true, skipped: true, desired: 0 })
  })
  it('pago confirmado reciente: genera el aviso informativo (fecha en hora argentina)', async () => {
    db.subscriptions = sub({ status: 'active', end_date: '2026-12-30' }); db.payments = ok({ id: 'p9', applied_at: '2026-11-09T02:00:00Z', updated_at: '2026-11-09T02:00:00Z' })
    await syncNotifications('u1', fake)
    expect(rpcCalls[0].args.p_desired[0]).toMatchObject({ kind: 'payment_confirmed', dedupe_key: 'payment_confirmed:s1:p9', due_date: '2026-11-08', source: 'payment' })
  })
  it('error técnico al leer la suscripción: NO escribe nada', async () => {
    db.subscriptions = { data: null, error: { code: 'XX000' } }
    expect(await syncNotifications('u1', fake)).toEqual({ ok: false, reason: 'degraded' })
    expect(rpcCalls).toHaveLength(0)
  })
  it('error al leer pagos o avisos: NO escribe nada', async () => {
    db.payments = { data: null, error: { code: 'XX000' } }
    expect(await syncNotifications('u1', fake)).toEqual({ ok: false, reason: 'read_error' })
    db.payments = ok(null); db.notifications = { data: null, error: { code: 'XX000' } }
    expect(await syncNotifications('u1', fake)).toEqual({ ok: false, reason: 'read_error' })
    expect(rpcCalls).toHaveLength(0)
  })
  it('error de la base al sincronizar: devuelve fallo, no lanza', async () => {
    rpcResult = { data: null, error: { code: '42501' } }
    expect(await syncNotifications('u1', fake)).toEqual({ ok: false, reason: 'rpc_error' })
  })
  it('una excepción inesperada tampoco rompe', async () => {
    const boom: any = { from: () => { throw new Error('boom') }, rpc: async () => ok(null) }
    expect(await syncNotifications('u1', boom)).toEqual({ ok: false, reason: 'unexpected' })
  })
})

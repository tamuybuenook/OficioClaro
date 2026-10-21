import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Res = { data: any; error: any }
const db: { user: any; profiles: Res; subscriptions: Res; payments: Res; app_settings: Res } = {} as any
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: keyof typeof db) => {
      const b: any = { select: () => b, eq: () => b, order: () => b, limit: () => b, maybeSingle: async () => db[table], then: (ok: any, ko: any) => Promise.resolve(db[table]).then(ok, ko) }
      return b
    },
  }),
}))

import { getMyAccess, requireFullAccess, LOCKED_MESSAGE } from './access'
import { getMyTradeLimit } from './userTrades'

const ok = (data: any): Res => ({ data, error: null })
const sub = (o: Record<string, any>) => ok({ id: 's1', status: 'active', end_date: '2026-11-20', mp_status: null, cancelled_at: null, plans: { max_trades: 3 }, ...o })

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T15:00:00Z')) // 10/11/2026 en Argentina
  db.user = { id: 'u1' }
  db.profiles = ok({ role: 'user' })
  db.subscriptions = sub({})
  db.payments = ok([{ id: 'p1' }])
  db.app_settings = ok([{ key: 'notice_days', value: 5 }, { key: 'grace_days', value: 5 }])
})
afterEach(() => vi.useRealTimers())

describe('getMyAccess', () => {
  it('activa y al día: acceso completo', async () => {
    const a = await getMyAccess()
    expect(a).toMatchObject({ phase: 'active_manual', hasAccess: true, locked: false, maxTrades: 3 })
  })
  it('prueba terminada sin pago: bloqueado de inmediato (sin gracia)', async () => {
    db.subscriptions = sub({ status: 'trial', end_date: '2026-11-09' }); db.payments = ok([])
    expect(await getMyAccess()).toMatchObject({ phase: 'lapsed', locked: true, subStatus: 'trial' })
  })
  it('cobro fallido con pago previo: gracia con acceso completo', async () => {
    db.subscriptions = sub({ status: 'active', end_date: '2026-11-07' })
    expect(await getMyAccess()).toMatchObject({ phase: 'grace', hasAccess: true, locked: false, graceEndsOn: '2026-11-12' })
  })
  it('pasada la gracia: bloqueado', async () => {
    db.subscriptions = sub({ status: 'active', end_date: '2026-11-04' })
    expect(await getMyAccess()).toMatchObject({ phase: 'lapsed', locked: true })
  })
  it('vencida sin ningún pago confirmado: sin gracia', async () => {
    db.subscriptions = sub({ status: 'active', end_date: '2026-11-07' }); db.payments = ok([])
    expect(await getMyAccess()).toMatchObject({ phase: 'lapsed', locked: true })
  })
  it('el administrador nunca queda bloqueado', async () => {
    db.profiles = ok({ role: 'admin' }); db.subscriptions = sub({ status: 'trial', end_date: '2026-01-01' })
    expect(await getMyAccess()).toMatchObject({ locked: false, isAdmin: true })
  })
  it('sin sesión o sin suscripción: bloqueado', async () => {
    db.user = null; expect((await getMyAccess()).locked).toBe(true)
    db.user = { id: 'u1' }; db.subscriptions = ok(null); expect((await getMyAccess()).locked).toBe(true)
  })
  it('fallo técnico al leer la suscripción: no bloquea (queda marcado como degradado)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.subscriptions = { data: null, error: { code: 'XX000' } }
    expect(await getMyAccess()).toMatchObject({ locked: false, degraded: true })
  })
  it('app_settings ilegible: usa los valores iniciales (gracia 5)', async () => {
    db.app_settings = { data: null, error: { code: '42P01' } }; db.subscriptions = sub({ end_date: '2026-11-07' })
    expect((await getMyAccess()).phase).toBe('grace')
  })
  it('gracia 0 configurada: al vencer se bloquea', async () => {
    db.app_settings = ok([{ key: 'grace_days', value: 0 }]); db.subscriptions = sub({ end_date: '2026-11-09' })
    expect((await getMyAccess()).locked).toBe(true)
  })
})

describe('requireFullAccess y límite de oficios', () => {
  it('bloqueado: devuelve el mensaje; con acceso: null', async () => {
    db.subscriptions = sub({ status: 'trial', end_date: '2026-11-09' }); db.payments = ok([])
    expect(await requireFullAccess()).toEqual({ error: LOCKED_MESSAGE })
    db.subscriptions = sub({})
    expect(await requireFullAccess()).toBeNull()
  })
  it('getMyTradeLimit: 0 si no hay acceso; el límite del plan en gracia', async () => {
    db.subscriptions = sub({ status: 'trial', end_date: '2026-11-09' }); db.payments = ok([])
    expect(await getMyTradeLimit('u1')).toBe(0)
    db.subscriptions = sub({ end_date: '2026-11-07', plans: { max_trades: 2 } }); db.payments = ok([{ id: 'p1' }])
    expect(await getMyTradeLimit('u1')).toBe(2)
  })
})

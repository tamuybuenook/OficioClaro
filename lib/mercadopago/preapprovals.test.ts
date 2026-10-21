import { describe, expect, it } from 'vitest'
import { MpApiError, type MpClient } from './client'
import type { MpStore, PreapprovalRow, PreapprovalStatus, SubRow, PlanRow } from './store'
import { OPEN_PREAPPROVAL } from './store'
import { cancelPreapproval, recoverPreapprovals, resolveCreating } from './preapprovals'
import { CheckoutError, cancelRenewal, startCheckout } from './checkout'
import { processMpEvent } from './process-event'

const PLAN: PlanRow = { id: '11111111-1111-1111-1111-111111111111', name: 'Pro', price: 9000, billing_period: 'monthly', is_active: true }
const PLAN2: PlanRow = { id: '44444444-4444-4444-4444-444444444444', name: 'Medium', price: 8000, billing_period: 'monthly', is_active: true }
const SUBID = '33333333-3333-3333-3333-333333333333'

// ---- Store en memoria con las MISMAS reglas que la base (un solo abierto por suscripción) ----
function memStore(opts: { failAttach?: boolean } = {}) {
  const rows: PreapprovalRow[] = []
  const incidents: any[] = []
  const payments: any[] = []
  let seq = 0
  const sub: SubRow = { id: SUBID, user_id: 'u1', plan_id: PLAN.id, status: 'active', end_date: '2099-01-01', mp_preapproval_id: null, mp_plan_id: null, mp_amount: null, mp_status: null, mp_init_point: null }
  const find = (id: string) => rows.find((r) => r.id === id)
  const store = {
    getPlan: async (id: string) => [PLAN, PLAN2].find((p) => p.id === id) ?? null,
    getLatestSubscription: async () => sub,
    createLapsedSubscription: async () => sub,
    getPreapprovalByMpId: async (m: string) => rows.find((r) => r.preapproval_id === m) ?? null,
    getPreapprovalById: async (id: string) => find(id) ?? null,
    listOpenPreapprovals: async (sid: string) => rows.filter((r) => r.subscription_id === sid && OPEN_PREAPPROVAL.includes(r.status)),
    listPreapprovalsToRecover: async () => rows.filter((r) => r.status === 'cancelling' || r.status === 'creating'),
    createPreapprovalRow: async (a: any) => {
      if (rows.some((r) => r.subscription_id === a.subscriptionId && OPEN_PREAPPROVAL.includes(r.status))) return null
      const row: PreapprovalRow = { id: `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`, subscription_id: a.subscriptionId, plan_id: a.planId, amount: a.amount, preapproval_id: null, status: 'creating', init_point: null, cancel_attempts: 0, last_error: null, created_at: new Date().toISOString() }
      rows.push(row); return { id: row.id }
    },
    attachPreapproval: async (id: string, mp: string, ip: string | null, st: PreapprovalStatus = 'pending') => {
      if (opts.failAttach) throw new Error('db down')
      const r = find(id)!; if (['creating', 'pending'].includes(r.status)) Object.assign(r, { preapproval_id: mp, init_point: ip, status: st })
    },
    setPreapprovalStatus: async (id: string, st: PreapprovalStatus) => { find(id)!.status = st },
    markCancelling: async (id: string) => { const r = find(id)!; r.status = 'cancelling'; r.cancel_attempts += 1 },
    markCancelled: async (id: string) => { find(id)!.status = 'cancelled' },
    recordCancelFailure: async (id: string, m: string) => { find(id)!.last_error = m },
    markPreapprovalFailed: async (id: string, m: string) => { const r = find(id)!; r.status = 'failed'; r.last_error = m },
    traceDeletedPayment: async (ref: string) => (ref === 'PRE-GONE' ? { found: true, user_id: 'u-borrado', subscription_id: 's-borrada' } : null),
    logIncident: async (_e: string, id: string, action: string, detail: any) => { incidents.push({ id, action, detail }) },
    recordPayment: async (a: any) => { payments.push(a); return { outcome: 'processed' } },
    findReusableIntent: async () => null, isUserDeletionHeld: async () => false, markIntentUncertain: async (id: string) => { /* sin cambios */ }, createIntent: async () => ({ id: 'i' }), setIntentCheckout: async () => {}, failIntent: async () => {},
  } as unknown as MpStore
  return { store, rows, incidents, payments }
}

type Handler = (body: any, path: string) => any
function mp(routes: Record<string, Handler | any>) {
  const log: { method: string; path: string; body?: any; key?: string }[] = []
  const client: MpClient = {
    request: async (method, path, body, key) => {
      log.push({ method, path, body, key })
      const k = `${method} ${path}`
      const h = routes[k] ?? routes[`${method} ${path.split('?')[0]}`]
      if (h === undefined) throw new MpApiError(404, 'nf')
      const out = typeof h === 'function' ? h(body, path) : h
      if (out instanceof Error) throw out
      return out
    },
  }
  return { client, log }
}
const TIMEOUT = new MpApiError(0, 'timeout')
const input = { userId: 'u1', email: 'a@b.com', planId: PLAN.id, mode: 'recurring' as const }
const seed = (rows: PreapprovalRow[], r: Partial<PreapprovalRow>) => { rows.push({ id: `00000000-0000-0000-0000-9999999999${String(rows.length).padStart(2, '0')}`, subscription_id: SUBID, plan_id: PLAN.id, amount: 9000, preapproval_id: 'OLD', status: 'pending', init_point: 'u-old', cancel_attempts: 0, last_error: null, created_at: new Date().toISOString(), ...r }); return rows[rows.length - 1] }

describe('cancelPreapproval', () => {
  it('éxito: PUT confirma "cancelled" => fila cancelada', async () => {
    const m = memStore(); const row = seed(m.rows, {})
    const { client } = mp({ 'PUT /preapproval/OLD': { status: 'cancelled' } })
    expect(await cancelPreapproval({ mp: client, store: m.store }, row)).toEqual({ ok: true })
    expect(row.status).toBe('cancelled'); expect(row.cancel_attempts).toBe(1); expect(m.incidents).toHaveLength(0)
  })
  it('PUT 200 sin estado cancelado: no se da por hecho; se verifica con GET', async () => {
    const m = memStore(); const row = seed(m.rows, {})
    const { client, log } = mp({ 'PUT /preapproval/OLD': { status: 'authorized' }, 'GET /preapproval/OLD': { status: 'authorized' } })
    const r = await cancelPreapproval({ mp: client, store: m.store }, row)
    expect(r.ok).toBe(false); expect(row.status).toBe('cancelling'); expect(log.some((l) => l.method === 'GET')).toBe(true)
    expect(m.incidents[0].action).toBe('mp_incident_cancel_unconfirmed')
  })
  it('rechazo (400/403) de MP: no confirmada, queda "cancelling", incidencia registrada, error NO descartado', async () => {
    const m = memStore(); const row = seed(m.rows, {})
    const { client } = mp({ 'PUT /preapproval/OLD': new MpApiError(400, 'bad'), 'GET /preapproval/OLD': { status: 'authorized' } })
    const r = await cancelPreapproval({ mp: client, store: m.store }, row)
    expect(r.ok).toBe(false); expect(row.status).toBe('cancelling'); expect(row.last_error).toMatch(/bad/); expect(m.incidents).toHaveLength(1)
  })
  it('timeout del PUT pero MP sí canceló: el GET lo confirma', async () => {
    const m = memStore(); const row = seed(m.rows, {})
    const { client } = mp({ 'PUT /preapproval/OLD': TIMEOUT, 'GET /preapproval/OLD': { status: 'cancelled' } })
    expect((await cancelPreapproval({ mp: client, store: m.store }, row)).ok).toBe(true); expect(row.status).toBe('cancelled')
  })
  it('timeout del PUT y del GET: resultado incierto => no se asume cancelada', async () => {
    const m = memStore(); const row = seed(m.rows, {})
    const { client } = mp({ 'PUT /preapproval/OLD': TIMEOUT, 'GET /preapproval/OLD': TIMEOUT })
    expect((await cancelPreapproval({ mp: client, store: m.store }, row)).ok).toBe(false); expect(row.status).toBe('cancelling'); expect(m.incidents).toHaveLength(1)
  })
  it('reintento: tras un fallo, el segundo intento confirma y cierra', async () => {
    const m = memStore(); const row = seed(m.rows, {})
    let calls = 0
    const { client } = mp({ 'PUT /preapproval/OLD': () => (++calls === 1 ? TIMEOUT : { status: 'cancelled' }), 'GET /preapproval/OLD': TIMEOUT })
    expect((await cancelPreapproval({ mp: client, store: m.store }, row)).ok).toBe(false)
    const rec = await recoverPreapprovals({ mp: client, store: m.store }, { olderThanMinutes: 0, limit: 10 })
    expect(rec).toEqual({ checked: 1, resolved: 1, unresolved: 0 }); expect(row.status).toBe('cancelled'); expect(row.cancel_attempts).toBe(2)
  })
  it('404 de MP: la autorización no existe => cerrada', async () => {
    const m = memStore(); const row = seed(m.rows, {})
    expect((await cancelPreapproval({ mp: mp({}).client, store: m.store }, row)).ok).toBe(true)
  })
})

describe('startRecurring: reemplazo recuperable', () => {
  const d = (m: ReturnType<typeof memStore>, c: MpClient) => ({ store: m.store, mp: c, appUrl: 'https://app.test' })

  it('alta limpia: registra la fila ANTES de crear en MP; external_reference = id de la fila; idempotency key = id de la fila', async () => {
    const m = memStore()
    const { client, log } = mp({ 'POST /preapproval': () => { expect(m.rows).toHaveLength(1); expect(m.rows[0].status).toBe('creating'); return { id: 'PRE1', init_point: 'https://mp/auth' } } })
    expect((await startCheckout(d(m, client), input)).url).toBe('https://mp/auth')
    expect(log[0].body.external_reference).toBe(m.rows[0].id); expect(log[0].key).toBe(m.rows[0].id)
    expect(m.rows[0]).toMatchObject({ preapproval_id: 'PRE1', status: 'pending', amount: 9000 })
  })
  it('reemplazo OK: cancela y confirma la anterior ANTES de crear la nueva; ambas quedan trazadas', async () => {
    const m = memStore(); const old = seed(m.rows, { plan_id: PLAN2.id, amount: 8000 })
    const order: string[] = []
    const { client } = mp({
      'PUT /preapproval/OLD': () => { order.push('cancel'); return { status: 'cancelled' } },
      'POST /preapproval': () => { order.push('create'); return { id: 'NEW', init_point: 'u-new' } },
    })
    await startCheckout(d(m, client), input)
    expect(order).toEqual(['cancel', 'create']); expect(old.status).toBe('cancelled')
    expect(m.rows.map((r) => [r.preapproval_id, r.status])).toEqual([['OLD', 'cancelled'], ['NEW', 'pending']])
  })
  it('si la cancelación anterior NO se confirma: no se crea otra, se informa el error y queda incidencia', async () => {
    const m = memStore(); const old = seed(m.rows, { plan_id: PLAN2.id, amount: 8000 })
    const { client, log } = mp({ 'PUT /preapproval/OLD': new MpApiError(500, 'x'), 'GET /preapproval/OLD': { status: 'pending' } })
    const err = await startCheckout(d(m, client), input).catch((e) => e)
    expect(err).toBeInstanceOf(CheckoutError); expect(String(err.message)).toMatch(/no creamos una nueva/)
    expect(log.some((l) => l.method === 'POST')).toBe(false)
    expect(old.status).toBe('cancelling'); expect(m.rows).toHaveLength(1); expect(m.incidents).toHaveLength(1)
  })
  it('timeout al cancelar y reintento posterior: la siguiente solicitud completa el reemplazo', async () => {
    const m = memStore(); seed(m.rows, { plan_id: PLAN2.id, amount: 8000 })
    let up = false
    const { client } = mp({ 'PUT /preapproval/OLD': () => (up ? { status: 'cancelled' } : TIMEOUT), 'GET /preapproval/OLD': () => (up ? { status: 'cancelled' } : TIMEOUT), 'POST /preapproval': { id: 'NEW', init_point: 'u-new' } })
    await expect(startCheckout(d(m, client), input)).rejects.toBeInstanceOf(CheckoutError)
    up = true
    expect((await startCheckout(d(m, client), input)).url).toBe('u-new')
    expect(m.rows.find((r) => r.preapproval_id === 'OLD')!.status).toBe('cancelled')
  })
  it('mismo plan y monto pendiente: reutiliza el enlace, sin crear ni cancelar', async () => {
    const m = memStore(); seed(m.rows, {})
    const { client, log } = mp({})
    expect((await startCheckout(d(m, client), input)).url).toBe('u-old'); expect(log).toHaveLength(0)
  })
  it('autorización activa: se bloquea el alta de otra', async () => {
    const m = memStore(); seed(m.rows, { status: 'authorized' })
    await expect(startCheckout(d(m, mp({}).client), input)).rejects.toThrow(/Cancelala/)
  })
  it('solicitud simultánea: el índice único impide un segundo alta abierta', async () => {
    const m = memStore(); seed(m.rows, { status: 'creating', preapproval_id: null })
    const { client } = mp({ 'GET /preapproval/search': { results: [] } })
    await expect(startCheckout(d(m, client), input)).rejects.toThrow(/en curso/)
  })
  it('timeout al crear en MP: si MP sí la creó, se recupera por external_reference y se devuelve su enlace', async () => {
    const m = memStore()
    let created: string | null = null
    const { client } = mp({
      'POST /preapproval': (body: any) => { created = body.external_reference; return TIMEOUT },
      'GET /preapproval/search': () => ({ results: [{ id: 'PRE-LATE', status: 'pending', init_point: 'https://mp/late' }] }),
    })
    expect((await startCheckout(d(m, client), input)).url).toBe('https://mp/late')
    expect(m.rows[0]).toMatchObject({ id: created, preapproval_id: 'PRE-LATE', status: 'pending' })
  })
  it('timeout al crear y MP no la tiene todavía: queda "creating" (no se da por fallida) y se informa error', async () => {
    const m = memStore()
    const { client } = mp({ 'POST /preapproval': TIMEOUT, 'GET /preapproval/search': { results: [] } })
    await expect(startCheckout(d(m, client), input)).rejects.toBeInstanceOf(CheckoutError)
    expect(m.rows[0].status).toBe('creating')
  })
  it('la base falla DESPUÉS de crear en MP: incidencia registrada y la fila queda recuperable', async () => {
    const m = memStore({ failAttach: true })
    const { client } = mp({ 'POST /preapproval': { id: 'PRE9', init_point: 'u' } })
    await expect(startCheckout(d(m, client), input)).rejects.toBeInstanceOf(CheckoutError)
    expect(m.rows[0].status).toBe('creating'); expect(m.incidents[0].action).toBe('mp_incident_attach_failed')
  })
  it('recuperación: una fila "creating" vieja que MP no tiene se cierra; si MP la tiene se vincula', async () => {
    const m = memStore()
    const stale = seed(m.rows, { status: 'creating', preapproval_id: null, created_at: new Date(Date.now() - 30 * 60_000).toISOString() })
    expect(await resolveCreating({ mp: mp({ 'GET /preapproval/search': { results: [] } }).client, store: m.store }, stale)).toBe('failed'); expect(stale.status).toBe('failed')
    const m2 = memStore(); const r2 = seed(m2.rows, { status: 'creating', preapproval_id: null })
    expect(await resolveCreating({ mp: mp({ 'GET /preapproval/search': { results: [{ id: 'X', status: 'authorized' }] } }).client, store: m2.store }, r2)).toBe('attached')
    expect(r2).toMatchObject({ preapproval_id: 'X', status: 'authorized' })
  })
  it('cancelar renovación: solo informa éxito si MP lo confirmó; si no, error y reintento posterior', async () => {
    const m = memStore(); const r = seed(m.rows, { status: 'authorized' })
    await expect(cancelRenewal({ store: m.store, mp: mp({ 'PUT /preapproval/OLD': TIMEOUT, 'GET /preapproval/OLD': TIMEOUT }).client, appUrl: 'x' }, 'u1')).rejects.toThrow(/No pudimos confirmar/)
    expect(r.status).toBe('cancelling')
    await cancelRenewal({ store: m.store, mp: mp({ 'PUT /preapproval/OLD': { status: 'cancelled' } }).client, appUrl: 'x' }, 'u1')
    expect(r.status).toBe('cancelled')
    await expect(cancelRenewal({ store: m.store, mp: mp({}).client, appUrl: 'x' }, 'u1')).rejects.toThrow(/No tenés/)
  })
})

describe('notificaciones de autorizaciones reemplazadas o tardías', () => {
  it('"authorized" tardío de una autorización ya cancelada: incidencia, se vuelve a cancelar, la suscripción no se toca', async () => {
    const m = memStore(); const row = seed(m.rows, { status: 'cancelled' })
    const { client, log } = mp({ 'GET /preapproval/OLD': { id: 'OLD', status: 'authorized', external_reference: row.id }, 'PUT /preapproval/OLD': { status: 'cancelled' } })
    const r = await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_preapproval', dataId: 'OLD' })
    expect(r.outcome).toBe('rejected'); expect(r.detail).toMatch(/volvió a cancelar/)
    expect(m.incidents[0].action).toBe('mp_incident_replaced_still_alive'); expect(log.some((l) => l.method === 'PUT')).toBe(true)
    expect(row.status).toBe('cancelled')
  })
  it('si la nueva cancelación no se confirma, el resultado lo dice y queda incidencia', async () => {
    const m = memStore(); const row = seed(m.rows, { status: 'cancelled' })
    const { client } = mp({ 'GET /preapproval/OLD': { id: 'OLD', status: 'authorized', external_reference: row.id }, 'PUT /preapproval/OLD': TIMEOUT })
    const r = await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_preapproval', dataId: 'OLD' })
    expect(r.detail).toMatch(/NO confirmada/); expect(m.incidents.map((i) => i.action)).toContain('mp_incident_cancel_unconfirmed')
  })
  it('notificación repetida de una cancelada que sigue cancelada: duplicado, sin acciones', async () => {
    const m = memStore(); const row = seed(m.rows, { status: 'cancelled' })
    const { client, log } = mp({ 'GET /preapproval/OLD': { id: 'OLD', status: 'cancelled', external_reference: row.id } })
    expect((await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_preapproval', dataId: 'OLD' })).outcome).toBe('duplicate')
    expect(log.some((l) => l.method === 'PUT')).toBe(false)
  })
  it('notificación vigente: autorizada actualiza el estado; external_reference ajeno se rechaza', async () => {
    const m = memStore(); const row = seed(m.rows, {})
    const ok = mp({ 'GET /preapproval/OLD': { id: 'OLD', status: 'authorized', external_reference: row.id } })
    expect((await processMpEvent({ mp: ok.client, store: m.store }, { topic: 'subscription_preapproval', dataId: 'OLD' })).outcome).toBe('processed'); expect(row.status).toBe('authorized')
    const bad = mp({ 'GET /preapproval/OLD': { id: 'OLD', status: 'paused', external_reference: 'otra' } })
    expect((await processMpEvent({ mp: bad.client, store: m.store }, { topic: 'subscription_preapproval', dataId: 'OLD' })).outcome).toBe('rejected'); expect(row.status).toBe('authorized')
  })
  it('notificación que llega antes de vincular el id: se vincula por external_reference', async () => {
    const m = memStore(); const row = seed(m.rows, { status: 'creating', preapproval_id: null })
    const { client } = mp({ 'GET /preapproval/NEWID': { id: 'NEWID', status: 'authorized', external_reference: row.id } })
    await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_preapproval', dataId: 'NEWID' })
    expect(row).toMatchObject({ preapproval_id: 'NEWID', status: 'authorized' })
  })
  it('cobro de una autorización cerrada: se registra con su preapproval (el SQL acredita y audita) y se reintenta cancelar', async () => {
    const m = memStore(); seed(m.rows, { status: 'cancelled' })
    const { client, log } = mp({
      'GET /authorized_payments/90': { id: 90, preapproval_id: 'OLD', payment: { id: 555 } },
      'GET /v1/payments/555': { id: 555, status: 'approved', transaction_amount: 9000, currency_id: 'ARS' },
      'PUT /preapproval/OLD': { status: 'cancelled' },
    })
    await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_authorized_payment', dataId: '90' })
    expect(m.payments[0]).toMatchObject({ subscriptionId: SUBID, preapprovalId: 'OLD', externalId: '555', mpStatus: 'approved' })
    expect(log.some((l) => l.method === 'PUT')).toBe(true)
  })
  it('cobro de una preapproval desconocida: ignorado sin registrar nada', async () => {
    const m = memStore()
    const { client } = mp({ 'GET /authorized_payments/90': { id: 90, preapproval_id: 'FOREIGN', payment: { id: 1 } } })
    expect((await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_authorized_payment', dataId: '90' })).outcome).toBe('ignored')
    expect(m.payments).toHaveLength(0)
  })
})

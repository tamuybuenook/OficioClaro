import { describe, expect, it } from 'vitest'
import { MpApiError, type MpClient } from './client'
import type { MpStore, PlanRow, PreapprovalRow, PreapprovalStatus, SubRow } from './store'
import { OPEN_PREAPPROVAL, RenewalsBlockedError, deletionHoldActive, type PendingPaymentRow } from './store'
import { CheckoutError, startCheckout } from './checkout'
import { recoverPreapprovals } from './preapprovals'
import { processMpEvent } from './process-event'
import { prepareUserDeletion, unavailableMp, windDownSubscription } from './lifecycle'

const SUB = '33333333-3333-3333-3333-333333333333'
const PLAN = '11111111-1111-1111-1111-111111111111'
const USER = '22222222-2222-2222-2222-222222222222'
const ADMIN = '99999999-9999-9999-9999-999999999999'

// Store en memoria: replica las reglas de mp_begin_wind_down (estado + seguimiento atómicos) y del ledger.
type MemSub = { id: string; status: string; deletion_hold_at?: string | null }
const PLANROW: PlanRow = { id: PLAN, name: 'Pro', price: 9000, billing_period: 'monthly', is_active: true }
function mem(opts: { heldPayments?: number; subs?: MemSub[]; failEnd?: boolean; failBegin?: boolean; listOpenFailsAfter?: number; createGate?: Promise<void>; createFails?: boolean; payments?: PendingPaymentRow[]; noSubs?: boolean } = {}) {
  const payments: PendingPaymentRow[] = opts.payments ?? []
  const rows: PreapprovalRow[] = []
  const incidents: { entity: string; id: string; action: string; detail: any; actor?: string | null }[] = []
  const subs: MemSub[] = opts.subs ?? [{ id: SUB, status: 'active' }]
  const calls: string[] = []
  let listCalls = 0
  const recorded: any[] = []
  let recordResult: any = { outcome: 'processed' }
  const find = (id: string) => rows.find((r) => r.id === id)!
  const store = {
    getPreapprovalByMpId: async (m: string) => rows.find((r) => r.preapproval_id === m) ?? null,
    getPreapprovalById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    listOpenPreapprovals: async (sid: string) => {
      if (opts.listOpenFailsAfter !== undefined && ++listCalls > opts.listOpenFailsAfter) throw new Error('db down')
      return rows.filter((r) => r.subscription_id === sid && OPEN_PREAPPROVAL.includes(r.status))
    },
    getPlan: async () => PLANROW,
    getLatestSubscription: async () => { const x = subs[0]; return { id: x.id, user_id: USER, plan_id: PLAN, status: x.status, end_date: '2099-01-01', mp_preapproval_id: null, mp_plan_id: null, mp_amount: null, mp_status: null, mp_init_point: null, deletion_hold_at: x.deletion_hold_at ?? null } as SubRow },
    findReusableIntent: async () => null, setIntentCheckout: async () => {}, failIntent: async (id: string) => { const p = payments.find((x) => x.id === id); if (p) { p.status = 'rejected'; p.mp_status = 'creation_failed' } },
    // === Réplica de la guardia mp_guard_payment_insert (retención por usuario) ===
    createIntent: async () => {
      if (subs.some((x) => deletionHoldActive(x))) throw new RenewalsBlockedError('mp:renewals_blocked')
      const p: PendingPaymentRow = { id: `intent-${payments.length + 1}`, provider: 'mercadopago', status: 'pending', mp_status: 'created', external_id: null, applied_at: null, review_resolution: null, created_at: new Date().toISOString() }
      payments.push(p); return { id: p.id }
    },
    isUserDeletionHeld: async () => subs.some((x) => deletionHoldActive(x)),
    listPendingPaymentsOfUser: async () => payments.filter((p) => p.status === 'pending' || (p.status === 'reconciled' && !p.applied_at && (!p.review_resolution || p.review_resolution === 'refund_pending'))),
    markIntentUncertain: async (id: string) => { const p = payments.find((x) => x.id === id); if (p && p.status === 'pending' && !p.external_id) p.mp_status = 'creation_uncertain' },
    // === Réplica de mp_expire_intent: solo MP, pendiente, sin external_id, sin aplicar y con más de 25 h ===
    expireIntent: async (id: string) => {
      const p = payments.find((x) => x.id === id)
      if (!p || p.provider !== 'mercadopago' || p.status !== 'pending' || p.external_id || p.applied_at) return { expired: false, reason: 'not_expirable' }
      if (new Date(p.created_at).getTime() > Date.now() - 25 * 3600_000) return { expired: false, reason: 'too_recent' }
      p.status = 'rejected'; p.mp_status = 'expired'; return { expired: true }
    },
    // === Réplica del trigger sync_mp_mirror (guardia de alta) + índice único de una autorización abierta por suscripción ===
    createPreapprovalRow: async (a: { subscriptionId: string; planId: string; amount: number }) => {
      if (opts.createGate) await opts.createGate
      if (opts.createFails) throw new Error('db down')
      const sub = subs.find((x) => x.id === a.subscriptionId)!
      if (sub.status === 'suspended' || deletionHoldActive(sub)) throw new RenewalsBlockedError('mp:renewals_blocked')
      if (rows.some((r) => r.subscription_id === a.subscriptionId && OPEN_PREAPPROVAL.includes(r.status))) return null
      const row: PreapprovalRow = { id: `00000000-0000-0000-0000-8888888888${String(rows.length).padStart(2, '0')}`, subscription_id: a.subscriptionId, plan_id: a.planId, amount: a.amount, preapproval_id: null, status: 'creating', init_point: null, cancel_attempts: 0, last_error: null, created_at: new Date().toISOString() }
      rows.push(row); return { id: row.id }
    },
    listPreapprovalsToRecover: async () => rows.filter((r) => r.status === 'cancelling' || r.status === 'creating'),
    attachPreapproval: async (id: string, mp: string, ip: string | null, st: PreapprovalStatus = 'pending') => {
      const r = find(id)
      if (['creating', 'pending'].includes(r.status)) Object.assign(r, { preapproval_id: mp, init_point: ip, status: st })
      else if (r.status === 'cancelling' && !r.preapproval_id) Object.assign(r, { preapproval_id: mp, init_point: ip })
    },
    setPreapprovalStatus: async (id: string, st: PreapprovalStatus) => { find(id).status = st },
    markCancelling: async (id: string) => { const r = find(id); if (OPEN_PREAPPROVAL.includes(r.status)) { r.status = 'cancelling'; r.cancel_attempts += 1 } },
    markCancelled: async (id: string) => { const r = find(id); r.status = 'cancelled'; r.last_error = null },
    recordCancelFailure: async (id: string, m: string) => { find(id).last_error = m },
    markPreapprovalFailed: async (id: string, m: string) => { const r = find(id); if (['creating', 'cancelling'].includes(r.status)) { r.status = 'failed'; r.last_error = m } },
    traceDeletedPayment: async (ref: string) => (ref === 'PRE-GONE' ? { found: true, user_id: 'u-borrado', subscription_id: 's-borrada' } : null),
    logIncident: async (entity: string, id: string, action: string, detail: any, actor?: string | null) => { incidents.push({ entity, id, action, detail, actor }) },
    // === mp_begin_wind_down ===
    beginWindDown: async (a: { subscriptionId: string; status: 'suspended' | 'cancelled'; planId: string | null; actorId: string | null }) => {
      const s = subs.find((x) => x.id === a.subscriptionId)!
      const previousStatus = s.status; s.status = a.status
      for (const r of rows) if (r.subscription_id === s.id && ['creating', 'pending', 'authorized', 'paused'].includes(r.status)) r.status = 'cancelling'
      return { previousStatus, preapprovalIds: rows.filter((r) => r.subscription_id === s.id && r.status === 'cancelling').map((r) => r.id) }
    },
    getSubscriptionsOfUser: async () => subs,
    // === mp_begin_user_deletion / mp_end_user_deletion_hold ===
    beginUserDeletion: async () => {
      calls.push('begin')
      if (opts.failBegin) throw new Error('db down')
      for (const x of subs) x.deletion_hold_at = new Date().toISOString()
      for (const r of rows) if (['creating', 'pending', 'authorized', 'paused'].includes(r.status)) r.status = 'cancelling'
      return { subscriptionIds: subs.map((x) => x.id), preapprovalIds: rows.filter((r) => r.status === 'cancelling').map((r) => r.id), pendingPaymentIds: payments.map((x) => x.id) }
    },
    endUserDeletionHold: async () => { calls.push('end'); if (opts.failEnd) throw new Error('db down'); for (const x of subs) x.deletion_hold_at = null },
    countHeldPayments: async () => opts.heldPayments ?? 0,
    recordPayment: async (a: any) => { recorded.push(a); return recordResult },
  } as unknown as MpStore
  const seed = (r: Partial<PreapprovalRow> = {}) => {
    rows.push({ id: `00000000-0000-0000-0000-9999999999${String(rows.length).padStart(2, '0')}`, subscription_id: SUB, plan_id: PLAN, amount: 9000, preapproval_id: `PRE-${rows.length}`, status: 'authorized', init_point: null, cancel_attempts: 0, last_error: null, created_at: new Date().toISOString(), ...r })
    return rows[rows.length - 1]
  }
  return { store, rows, incidents, subs, payments, seed, recorded, calls, setRecordResult: (r: any) => { recordResult = r } }
}

type Handler = (body: any, path: string) => any
function mp(routes: Record<string, Handler | any>) {
  const log: { method: string; path: string; body?: any }[] = []
  const client: MpClient = {
    request: async (method, path, body) => {
      log.push({ method, path, body })
      const h = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`]
      if (h === undefined) throw new MpApiError(404, 'nf')
      const out = typeof h === 'function' ? h(body, path) : h
      if (out instanceof Error) throw out
      return out
    },
  }
  return { client, log }
}
const TIMEOUT = new MpApiError(0, 'timeout')
const REJECT = new MpApiError(400, 'Mercado Pago respondió 400')
const wd = { subscriptionId: SUB, status: 'suspended' as const, planId: null, actorId: ADMIN }

describe('windDownSubscription: suspender/cancelar con renovación activa', () => {
  it('cancelación confirmada: estado aplicado, autorización cancelada, sin incidencias', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A' })
    const { client, log } = mp({ 'PUT /preapproval/PRE-A': { status: 'cancelled' } })
    const r = await windDownSubscription({ mp: client, store: m.store }, wd)
    expect(r).toMatchObject({ previousStatus: 'active', allConfirmed: true })
    expect(m.subs[0].status).toBe('suspended'); expect(row.status).toBe('cancelled'); expect(row.last_error).toBeNull()
    expect(log.filter((l) => l.method === 'PUT')).toHaveLength(1); expect(m.incidents).toHaveLength(0)
  })
  it('rechazo de MP (400) y la autorización sigue viva: NO se da por cancelada; queda en seguimiento con incidente', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': REJECT, 'GET /preapproval/PRE-A': { status: 'authorized' } })
    const r = await windDownSubscription({ mp: client, store: m.store }, wd)
    expect(r.allConfirmed).toBe(false)
    expect(m.subs[0].status).toBe('suspended')            // quitar acceso no depende de un tercero
    expect(row.status).toBe('cancelling'); expect(row.last_error).toMatch(/400/)
    expect(m.incidents.map((i) => i.action)).toContain('mp_incident_cancel_unconfirmed')
  })
  it('timeout en el PUT y en la consulta: resultado incierto => NO cancelada', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': TIMEOUT, 'GET /preapproval/PRE-A': TIMEOUT })
    const r = await windDownSubscription({ mp: client, store: m.store }, wd)
    expect(r.allConfirmed).toBe(false); expect(row.status).toBe('cancelling')
    expect(m.incidents).toHaveLength(1)
  })
  it('timeout en el PUT pero el GET demuestra que MP sí canceló: se confirma', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': TIMEOUT, 'GET /preapproval/PRE-A': { status: 'cancelled' } })
    expect((await windDownSubscription({ mp: client, store: m.store }, wd)).allConfirmed).toBe(true)
    expect(row.status).toBe('cancelled')
  })
  it('Mercado Pago no configurado: queda en seguimiento, nunca cancelada', async () => {
    const m = mem(); const row = m.seed()
    const r = await windDownSubscription({ mp: unavailableMp, store: m.store }, wd)
    expect(r.allConfirmed).toBe(false); expect(row.status).toBe('cancelling')
  })
  it('REINTENTO: tras el fallo, el cron confirma y cierra la fila (los intentos quedan contados)', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A' })
    await windDownSubscription({ mp: mp({ 'PUT /preapproval/PRE-A': TIMEOUT, 'GET /preapproval/PRE-A': TIMEOUT }).client, store: m.store }, wd)
    expect(row.status).toBe('cancelling')
    const ok = mp({ 'PUT /preapproval/PRE-A': { status: 'cancelled' } })
    const rec = await recoverPreapprovals({ mp: ok.client, store: m.store }, { olderThanMinutes: 0, limit: 10 })
    expect(rec).toMatchObject({ checked: 1, resolved: 1, unresolved: 0 })
    expect(row.status).toBe('cancelled'); expect(row.cancel_attempts).toBe(2)
  })
  it('idempotente: repetirlo no vuelve a llamar a MP ni genera incidencias', async () => {
    const m = mem(); m.seed({ preapproval_id: 'PRE-A' })
    const { client, log } = mp({ 'PUT /preapproval/PRE-A': { status: 'cancelled' } })
    await windDownSubscription({ mp: client, store: m.store }, wd)
    const r2 = await windDownSubscription({ mp: client, store: m.store }, wd)
    expect(r2.allConfirmed).toBe(true); expect(log.filter((l) => l.method === 'PUT')).toHaveLength(1); expect(m.incidents).toHaveLength(0)
  })
  it('simultáneo: dos administradores a la vez terminan con una única fila cancelada y sin incidencias', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': { status: 'cancelled' } })
    const [a, b] = await Promise.all([windDownSubscription({ mp: client, store: m.store }, wd), windDownSubscription({ mp: client, store: m.store }, { ...wd, status: 'cancelled' })])
    expect(a.allConfirmed && b.allConfirmed).toBe(true); expect(row.status).toBe('cancelled'); expect(m.incidents).toHaveLength(0)
  })
  it('creación en curso (sin id de MP): queda en seguimiento y no se cancela a ciegas; si MP nunca la creó y ya es vieja, se cierra', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: null, status: 'creating' })
    const { client } = mp({ 'GET /preapproval/search': { results: [] } })
    const r = await windDownSubscription({ mp: client, store: m.store }, wd)
    expect(r.allConfirmed).toBe(false); expect(row.status).toBe('cancelling')
    row.created_at = new Date(Date.now() - 30 * 60_000).toISOString()
    const rec = await recoverPreapprovals({ mp: client, store: m.store }, { olderThanMinutes: 0, limit: 10 })
    expect(rec.resolved).toBe(1); expect(row.status).toBe('failed')
  })
  it('creación en curso que MP sí creó: se vincula el id y se cancela', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: null, status: 'creating' })
    const { client } = mp({ 'GET /preapproval/search': { results: [{ id: 'PRE-LATE', status: 'pending' }] }, 'PUT /preapproval/PRE-LATE': { status: 'cancelled' } })
    expect((await windDownSubscription({ mp: client, store: m.store }, wd)).allConfirmed).toBe(true)
    expect(row.preapproval_id).toBe('PRE-LATE'); expect(row.status).toBe('cancelled')
  })
  it('sin renovaciones: solo cambia el estado', async () => {
    const m = mem(); const { client, log } = mp({})
    const r = await windDownSubscription({ mp: client, store: m.store }, wd)
    expect(r).toMatchObject({ allConfirmed: true, rows: [] }); expect(log).toHaveLength(0); expect(m.subs[0].status).toBe('suspended')
  })
})

describe('notificaciones tardías y cobros posteriores a la suspensión', () => {
  const approvedFlow = (m: ReturnType<typeof mem>, extra: Record<string, any> = {}) => mp({
    'GET /authorized_payments/AP1': { preapproval_id: 'PRE-A', payment: { id: 'P1' } },
    'GET /v1/payments/P1': { id: 'P1', status: 'approved', transaction_amount: 9000, currency_id: 'ARS' },
    ...extra,
  })
  it('pago aprobado tras la suspensión: el resultado "held" dispara la cancelación de la autorización viva', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A', status: 'authorized' })
    m.setRecordResult({ outcome: 'held', detail: 'subscription_suspended' })
    const { client, log } = approvedFlow(m, { 'PUT /preapproval/PRE-A': { status: 'cancelled' } })
    const out = await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_authorized_payment', dataId: 'AP1' })
    expect(out.outcome).toBe('held'); expect(m.recorded).toHaveLength(1)
    expect(log.some((l) => l.method === 'PUT' && l.path === '/preapproval/PRE-A')).toBe(true); expect(row.status).toBe('cancelled')
  })
  it('pago retenido y la cancelación no se confirma: la fila queda en seguimiento (sin romper el webhook)', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A', status: 'authorized' })
    m.setRecordResult({ outcome: 'held' })
    const { client } = approvedFlow(m, { 'PUT /preapproval/PRE-A': TIMEOUT, 'GET /preapproval/PRE-A': TIMEOUT })
    const out = await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_authorized_payment', dataId: 'AP1' })
    expect(out.outcome).toBe('held'); expect(row.status).toBe('cancelling')
  })
  it('notificación repetida de un cobro ya retenido (duplicate): no reintenta nada extra sobre una fila ya cancelada', async () => {
    const m = mem(); m.seed({ preapproval_id: 'PRE-A', status: 'cancelled' })
    m.setRecordResult({ outcome: 'duplicate' })
    const { client } = approvedFlow(m, { 'PUT /preapproval/PRE-A': { status: 'cancelled' }, 'GET /preapproval/PRE-A': { status: 'cancelled' } })
    expect((await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_authorized_payment', dataId: 'AP1' })).outcome).toBe('duplicate')
  })
  it('notificación tardía "authorized" de una autorización ya cancelada por la suspensión: incidencia y nueva cancelación', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A', status: 'cancelled' })
    const { client } = mp({ 'GET /preapproval/PRE-A': { id: 'PRE-A', status: 'authorized', external_reference: row.id }, 'PUT /preapproval/PRE-A': { status: 'cancelled' } })
    const out = await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_preapproval', dataId: 'PRE-A' })
    expect(out.outcome).toBe('rejected'); expect(m.incidents.map((i) => i.action)).toContain('mp_incident_replaced_still_alive')
  })
  it('cobro de una autorización que ya no figura (usuario eliminado): no se acredita y queda incidencia', async () => {
    const m = mem()
    const { client } = mp({ 'GET /authorized_payments/AP9': { preapproval_id: 'PRE-GONE', payment: { id: 'P9' } }, 'GET /preapproval/PRE-GONE': { id: 'PRE-GONE', external_reference: 'x' } })
    const out = await processMpEvent({ mp: client, store: m.store }, { topic: 'subscription_authorized_payment', dataId: 'AP9' })
    expect(out.outcome).toBe('ignored'); expect(m.recorded).toHaveLength(0)
    expect(m.incidents[0]).toMatchObject({ action: 'mp_incident_unknown_preapproval_charge', detail: { preapproval_id: 'PRE-GONE', payment_id: 'P9', deleted_account: { user_id: 'u-borrado', subscription_id: 's-borrada' } } })
  })
})

describe('prepareUserDeletion: eliminación de usuario con renovación activa', () => {
  const del = { userId: USER, actorId: ADMIN }
  it('sin renovaciones: puede eliminarse y queda auditado', async () => {
    const m = mem(); const { client } = mp({})
    const r = await prepareUserDeletion({ mp: client, store: m.store }, del)
    expect(r).toEqual({ ok: true, cancelledPreapprovals: [] }); expect(m.incidents[0]).toMatchObject({ action: 'admin_delete_user_renewals_cancelled', actor: ADMIN })
  })
  it('renovación activa confirmada: cancela ANTES de autorizar el borrado y audita los ids de MP', async () => {
    const m = mem(); m.seed({ preapproval_id: 'PRE-A' })
    const { client, log } = mp({ 'PUT /preapproval/PRE-A': { status: 'cancelled' } })
    const r = await prepareUserDeletion({ mp: client, store: m.store }, del)
    expect(r).toEqual({ ok: true, cancelledPreapprovals: ['PRE-A'] }); expect(log[0]).toMatchObject({ method: 'PUT', path: '/preapproval/PRE-A' })
    expect(m.incidents.at(-1)?.detail.preapproval_ids).toEqual(['PRE-A'])
  })
  it('rechazo de MP: NO se elimina; el ledger conserva la autorización en seguimiento', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': REJECT, 'GET /preapproval/PRE-A': { status: 'authorized' } })
    const r = await prepareUserDeletion({ mp: client, store: m.store }, del)
    expect(r).toMatchObject({ ok: false, reason: 'pending_cancellation' }); expect(row.status).toBe('cancelling')
    expect(m.incidents.map((i) => i.action)).not.toContain('admin_delete_user_renewals_cancelled')
  })
  it('timeout / resultado incierto: NO se elimina', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': TIMEOUT, 'GET /preapproval/PRE-A': TIMEOUT })
    expect(await prepareUserDeletion({ mp: client, store: m.store }, del)).toMatchObject({ ok: false, reason: 'pending_cancellation' })
    expect(row.status).toBe('cancelling')
  })
  it('REINTENTO: tras un fallo, un nuevo intento con MP disponible sí autoriza el borrado', async () => {
    const m = mem(); m.seed({ preapproval_id: 'PRE-A' })
    const bad = mp({ 'PUT /preapproval/PRE-A': TIMEOUT, 'GET /preapproval/PRE-A': TIMEOUT }).client
    expect((await prepareUserDeletion({ mp: bad, store: m.store }, del)).ok).toBe(false)
    const good = mp({ 'PUT /preapproval/PRE-A': { status: 'cancelled' } }).client
    expect(await prepareUserDeletion({ mp: good, store: m.store }, del)).toMatchObject({ ok: true, cancelledPreapprovals: ['PRE-A'] })
  })
  it('cobros retenidos sin resolver: no se elimina (borraría el rastro del dinero) y no se llama a MP', async () => {
    const m = mem({ heldPayments: 1 }); m.seed({ preapproval_id: 'PRE-A' })
    const { client, log } = mp({})
    expect(await prepareUserDeletion({ mp: client, store: m.store }, del)).toMatchObject({ ok: false, reason: 'held_payments' }); expect(log).toHaveLength(0)
  })
  it('aparece una autorización nueva mientras se cancelaba: no se elimina', async () => {
    const m = mem(); m.seed({ preapproval_id: 'PRE-A' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': () => { m.seed({ preapproval_id: 'PRE-NEW', status: 'pending' }); return { status: 'cancelled' } } })
    expect(await prepareUserDeletion({ mp: client, store: m.store }, del)).toMatchObject({ ok: false, reason: 'new_authorization' })
  })
  it('varias suscripciones: todas deben quedar confirmadas', async () => {
    const m = mem({ subs: [{ id: SUB, status: 'active' }, { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'cancelled' }] })
    m.seed({ preapproval_id: 'PRE-A' }); m.seed({ preapproval_id: 'PRE-B', subscription_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': { status: 'cancelled' }, 'PUT /preapproval/PRE-B': TIMEOUT, 'GET /preapproval/PRE-B': TIMEOUT })
    expect((await prepareUserDeletion({ mp: client, store: m.store }, del)).ok).toBe(false)
  })
})

describe('eliminación de usuario: retención y orden de operaciones', () => {
  const del = { userId: USER, actorId: ADMIN }
  it('la retención se activa ANTES de llamar a MP, y se mantiene si todo se confirmó (hasta borrar)', async () => {
    const m = mem(); m.seed({ preapproval_id: 'PRE-A' })
    const order: string[] = []
    const { client } = mp({ 'PUT /preapproval/PRE-A': () => { order.push(`PUT(hold=${m.subs[0].deletion_hold_at ? 'si' : 'no'})`); return { status: 'cancelled' } } })
    const r = await prepareUserDeletion({ mp: client, store: m.store }, del)
    expect(r.ok).toBe(true); expect(order).toEqual(['PUT(hold=si)']); expect(m.calls).toEqual(['begin']); expect(m.subs[0].deletion_hold_at).toBeTruthy()
  })
  it('cancelación rechazada: se libera la retención (la cuenta sigue operando) y el ledger queda en seguimiento', async () => {
    const m = mem(); const row = m.seed({ preapproval_id: 'PRE-A' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': REJECT, 'GET /preapproval/PRE-A': { status: 'authorized' } })
    expect(await prepareUserDeletion({ mp: client, store: m.store }, del)).toMatchObject({ ok: false, reason: 'pending_cancellation' })
    expect(m.calls).toEqual(['begin', 'end']); expect(m.subs[0].deletion_hold_at).toBeNull(); expect(row.status).toBe('cancelling')
  })
  it('timeout: se libera la retención y no se borra', async () => {
    const m = mem(); m.seed({ preapproval_id: 'PRE-A' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': TIMEOUT, 'GET /preapproval/PRE-A': TIMEOUT })
    expect((await prepareUserDeletion({ mp: client, store: m.store }, del)).ok).toBe(false); expect(m.calls).toEqual(['begin', 'end'])
  })
  it('error de base AL ACTIVAR la retención: se propaga, no se llama a MP y no hay nada que liberar', async () => {
    const m = mem({ failBegin: true }); m.seed({ preapproval_id: 'PRE-A' })
    const { client, log } = mp({})
    await expect(prepareUserDeletion({ mp: client, store: m.store }, del)).rejects.toThrow('db down')
    expect(log).toHaveLength(0); expect(m.calls).toEqual(['begin'])
  })
  it('error de base A MITAD (al listar autorizaciones): se libera la retención y se propaga; no autoriza el borrado', async () => {
    const m = mem({ listOpenFailsAfter: 0 }); m.seed({ preapproval_id: 'PRE-A' })
    await expect(prepareUserDeletion({ mp: mp({}).client, store: m.store }, del)).rejects.toThrow('db down')
    expect(m.calls).toEqual(['begin', 'end'])
  })
  it('si además falla liberar la retención, el resultado no se enmascara (la retención vence sola)', async () => {
    const m = mem({ failEnd: true }); m.seed({ preapproval_id: 'PRE-A' })
    const { client } = mp({ 'PUT /preapproval/PRE-A': TIMEOUT, 'GET /preapproval/PRE-A': TIMEOUT })
    expect(await prepareUserDeletion({ mp: client, store: m.store }, del)).toMatchObject({ ok: false, reason: 'pending_cancellation' })
  })
  it('cobros retenidos: no se activa ninguna retención ni se llama a MP', async () => {
    const m = mem({ heldPayments: 2 }); const { client, log } = mp({})
    expect(await prepareUserDeletion({ mp: client, store: m.store }, del)).toMatchObject({ ok: false, reason: 'held_payments' })
    expect(m.calls).toEqual([]); expect(log).toHaveLength(0)
  })
})

describe('checkout recurrente vs. eliminación (solicitudes simultáneas)', () => {
  const input = { userId: USER, email: 'a@b.com', planId: PLAN, mode: 'recurring' as const }
  const ok = { 'POST /preapproval': { id: 'PRE-NEW', init_point: 'https://mp/init' } }
  const deps = (m: ReturnType<typeof mem>, routes: Record<string, any>) => { const c = mp(routes); return { d: { store: m.store, mp: c.client, appUrl: 'https://app.test' }, log: c.log } }

  it('con la retención vigente el checkout (recurrente y único) falla rápido, sin tocar MP ni crear filas', async () => {
    const m = mem({ subs: [{ id: SUB, status: 'cancelled', deletion_hold_at: new Date().toISOString() }] })
    const { d, log } = deps(m, ok)
    await expect(startCheckout(d, input)).rejects.toBeInstanceOf(CheckoutError)
    await expect(startCheckout(d, { ...input, mode: 'one_time' })).rejects.toThrow(/procesada/)
    expect(log).toHaveLength(0); expect(m.rows).toHaveLength(0)
  })
  it('retención vencida (> 30 min, proceso caído): la cuenta puede volver a suscribirse', async () => {
    const m = mem({ subs: [{ id: SUB, status: 'cancelled', deletion_hold_at: new Date(Date.now() - 31 * 60_000).toISOString() }] })
    const { d } = deps(m, ok)
    expect(await startCheckout(d, input)).toEqual({ url: 'https://mp/init' })
  })
  it('cuenta cancelada SIN eliminación en curso: re-suscripción normal', async () => {
    const m = mem({ subs: [{ id: SUB, status: 'cancelled' }] })
    const { d } = deps(m, ok)
    expect(await startCheckout(d, input)).toEqual({ url: 'https://mp/init' }); expect(m.rows[0]).toMatchObject({ status: 'pending', preapproval_id: 'PRE-NEW' })
  })
  it('cuenta suspendida: no puede abrir autorizaciones', async () => {
    const m = mem({ subs: [{ id: SUB, status: 'suspended' }] }); const { d, log } = deps(m, ok)
    await expect(startCheckout(d, input)).rejects.toThrow(/suspendida/); expect(log).toHaveLength(0)
  })
  it('CARRERA: el checkout leyó la cuenta sin retención, la eliminación se completó, y recién entonces intenta crear: la base lo rechaza, no se llama a MP y la eliminación sigue siendo válida', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const m = mem({ createGate: gate }); const { d, log } = deps(m, ok)
    const checkout = startCheckout(d, input)                       // pasó las verificaciones; queda esperando antes del INSERT
    await new Promise((r) => setTimeout(r, 5))
    const del = await prepareUserDeletion({ mp: mp({}).client, store: m.store }, { userId: USER, actorId: ADMIN }) // retención + verificación
    expect(del.ok).toBe(true)
    release()
    await expect(checkout).rejects.toThrow(/procesada/)
    expect(log.filter((l) => l.method === 'POST')).toHaveLength(0)  // MP nunca recibió una autorización nueva
    expect(m.rows).toHaveLength(0)                                  // y no quedó ninguna fila abierta
  })
  it('CARRERA inversa: el checkout ya creó su fila "creating"; la eliminación la pasa a seguimiento y NO la da por cancelada sin confirmar (no borra)', async () => {
    const m = mem()
    const row = (await m.store.createPreapprovalRow({ subscriptionId: SUB, planId: PLAN, amount: 9000 }))!
    const { client } = mp({ 'GET /preapproval/search': { results: [] } })
    const r = await prepareUserDeletion({ mp: client, store: m.store }, { userId: USER, actorId: ADMIN })
    expect(r).toMatchObject({ ok: false, reason: 'pending_cancellation' })
    expect(m.rows.find((x) => x.id === row.id)!.status).toBe('cancelling'); expect(m.calls).toEqual(['begin', 'end'])
  })
  it('CARRERA inversa con MP: si la autorización se creó en MP durante la eliminación, se vincula y se cancela', async () => {
    const m = mem(); await m.store.createPreapprovalRow({ subscriptionId: SUB, planId: PLAN, amount: 9000 })
    const { client } = mp({ 'GET /preapproval/search': { results: [{ id: 'PRE-RACE', status: 'pending' }] }, 'PUT /preapproval/PRE-RACE': { status: 'cancelled' } })
    expect(await prepareUserDeletion({ mp: client, store: m.store }, { userId: USER, actorId: ADMIN })).toMatchObject({ ok: true, cancelledPreapprovals: ['PRE-RACE'] })
  })
  it('error de base al registrar la autorización: se propaga (no se confunde con "bloqueada") y MP no recibe nada', async () => {
    const m = mem({ createFails: true }); const { d, log } = deps(m, ok)
    await expect(startCheckout(d, input)).rejects.toThrow('db down'); expect(log.filter((l) => l.method === 'POST')).toHaveLength(0)
  })
  it('dos checkouts recurrentes simultáneos: solo uno crea la autorización (índice único); el otro recibe "intento en curso"', async () => {
    const m = mem(); const { d } = deps(m, ok)
    const res = await Promise.allSettled([startCheckout(d, input), startCheckout(d, input)])
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(m.rows.filter((r) => OPEN_PREAPPROVAL.includes(r.status))).toHaveLength(1)
  })
})

// ---------- Etapa 1 (0028): pagos únicos pendientes durante la eliminación ----------
describe('eliminación de usuario con pagos únicos pendientes', () => {
  const pay = (o: Partial<PendingPaymentRow> = {}): PendingPaymentRow => ({
    id: 'intent-A', provider: 'mercadopago', status: 'pending', mp_status: 'created', external_id: null, applied_at: null,
    review_resolution: null, created_at: new Date().toISOString(), ...o,
  })
  const old = () => new Date(Date.now() - 26 * 3600_000).toISOString()
  const run = (m: ReturnType<typeof mem>, routes: Record<string, any>) => prepareUserDeletion({ mp: mp(routes).client, store: m.store }, { userId: USER, actorId: ADMIN })

  it('1) pago único pendiente y reciente sin resultado en MP: NO se elimina, se libera la retención y el pago se conserva pendiente', async () => {
    const m = mem({ payments: [pay()] })
    const r = await run(m, { 'GET /v1/payments/search': { results: [] } })
    expect(r).toMatchObject({ ok: false, reason: 'pending_payments' })
    expect(m.payments[0].status).toBe('pending'); expect(m.calls).toEqual(['begin', 'end'])
  })
  it('timeout de MP al consultar el pago pendiente: bloquea la eliminación y NO marca el pago como fallido', async () => {
    const m = mem({ payments: [pay({ created_at: old() })] })
    const r = await run(m, { 'GET /v1/payments/search': new MpApiError(0, 'timeout') })
    expect(r).toMatchObject({ ok: false, reason: 'pending_payments' })
    expect(m.payments[0]).toMatchObject({ status: 'pending', mp_status: 'created' }); expect(m.calls).toEqual(['begin', 'end'])
  })
  it('transferencia pendiente de revisión: bloquea hasta conciliarla', async () => {
    const m = mem({ payments: [pay({ provider: 'transfer', mp_status: null })] })
    const r = await run(m, {})
    expect(r).toMatchObject({ ok: false, reason: 'pending_payments' }); expect(m.payments[0].status).toBe('pending')
  })
  it('3) pago APROBADO durante el intento: se procesa por el mismo camino del webhook y recién entonces se evalúa', async () => {
    const m = mem({ payments: [pay()] })
    const store = m.store as any
    store.recordPayment = async (a: any) => { m.recorded.push(a); m.payments[0].status = 'approved'; m.payments[0].applied_at = new Date().toISOString(); return { outcome: 'processed' } }
    store.getIntent = async (id: string) => ({ id, subscription_id: SUB })
    const r = await run(m, {
      'GET /v1/payments/search': { results: [{ id: 777 }] },
      'GET /v1/payments/777': { id: 777, status: 'approved', external_reference: 'intent-A'.padEnd(36, '0').replace(/./g, (c, i) => '22222222-2222-2222-2222-222222222222'[i]), transaction_amount: 9000, currency_id: 'ARS' },
    })
    expect(m.recorded).toHaveLength(1); expect(m.recorded[0].externalId).toBe('777')
    expect(r.ok).toBe(true)
  })
  it('cobro aprobado pero retenido (held) durante el proceso: bloquea y conserva el registro', async () => {
    const m = mem({ payments: [pay()] })
    const store = m.store as any
    store.recordPayment = async () => { Object.assign(m.payments[0], { status: 'reconciled', external_id: '778' }); return { outcome: 'held' } }
    store.getIntent = async (id: string) => ({ id, subscription_id: SUB })
    const r = await run(m, {
      'GET /v1/payments/search': { results: [{ id: 778 }] },
      'GET /v1/payments/778': { id: 778, status: 'approved', external_reference: '22222222-2222-2222-2222-222222222222', transaction_amount: 9000, currency_id: 'ARS' },
    })
    expect(r).toMatchObject({ ok: false, reason: 'pending_payments' }); expect(m.payments[0].status).toBe('reconciled')
  })
  it('reembolso PENDIENTE (refund_pending): bloquea la eliminación, se libera la retención y el pago se conserva', async () => {
    const m = mem({ payments: [pay({ status: 'reconciled', external_id: '901', mp_status: 'approved', review_resolution: 'refund_pending' })] })
    const r = await run(m, {})
    expect(r).toMatchObject({ ok: false, reason: 'pending_payments' })
    expect(m.payments[0]).toMatchObject({ status: 'reconciled', review_resolution: 'refund_pending' }); expect(m.calls).toEqual(['begin', 'end'])
  })
  it('reembolso ya COMPLETADO (refunded): no bloquea', async () => {
    const m = mem({ payments: [pay({ status: 'reconciled', external_id: '902', mp_status: 'refunded', review_resolution: 'refunded' })] })
    expect((await run(m, {})).ok).toBe(true)
  })
  it('8) intención vencida (>25 h) sin ningún pago en MP: se cierra como vencida y la eliminación procede', async () => {
    const m = mem({ payments: [pay({ created_at: old(), mp_status: 'creation_uncertain' })] })
    const r = await run(m, { 'GET /v1/payments/search': { results: [] } })
    expect(r.ok).toBe(true); expect(m.payments[0]).toMatchObject({ status: 'rejected', mp_status: 'expired' })
  })
  it('intención con pago asociado (external_id) todavía pendiente en MP: nunca se cierra por vencimiento', async () => {
    const m = mem({ payments: [pay({ created_at: old(), external_id: '900', mp_status: 'in_process' })] })
    const r = await run(m, { 'GET /v1/payments/search': { results: [] } })
    expect(r).toMatchObject({ ok: false, reason: 'pending_payments' }); expect(m.payments[0].status).toBe('pending')
  })
  it('2) checkout único simultáneo con la retención vigente: la base lo rechaza (RenewalsBlockedError) y no se crea ninguna intención', async () => {
    const m = mem()
    await m.store.beginUserDeletion({ userId: USER, actorId: ADMIN })
    await expect(m.store.createIntent({ subscriptionId: SUB, planId: PLAN, amount: 9000 })).rejects.toBeInstanceOf(RenewalsBlockedError)
    expect(m.payments).toHaveLength(0)
  })
})

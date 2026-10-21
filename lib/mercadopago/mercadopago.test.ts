import { describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyMpSignature } from './signature'
import { getMpConfig, MpConfigError } from './config'
import { mapPaymentStatus } from './status'
import { hasAccess, displayState } from '../subscription-access'
import { MpApiError, createMpClient, type MpClient } from './client'
import { processMpEvent } from './process-event'
import { cancelRenewal, CheckoutError, startCheckout } from './checkout'
import type { MpStore, PlanRow, SubRow } from './store'

const SECRET = 'whsec_test'
const sign = (dataId: string, requestId: string, ts = '1700000000', secret = SECRET) =>
  `ts=${ts},v1=${createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')}`

describe('firma del webhook', () => {
  it('acepta una firma válida', () => expect(verifyMpSignature({ secret: SECRET, signatureHeader: sign('123', 'r1'), requestId: 'r1', dataId: '123' })).toBe(true))
  it('data.id alfanumérico se firma en minúsculas', () => expect(verifyMpSignature({ secret: SECRET, signatureHeader: sign('abc123', 'r1'), requestId: 'r1', dataId: 'ABC123' })).toBe(true))
  it('rechaza secreto incorrecto, id o request-id alterados, ts alterado', () => {
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: sign('123', 'r1', '1', 'otro'), requestId: 'r1', dataId: '123' })).toBe(false)
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: sign('123', 'r1'), requestId: 'r1', dataId: '124' })).toBe(false)
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: sign('123', 'r1'), requestId: 'r2', dataId: '123' })).toBe(false)
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: sign('123', 'r1').replace('ts=1700000000', 'ts=1700000001'), requestId: 'r1', dataId: '123' })).toBe(false)
  })
  it('rechaza headers ausentes o mal formados', () => {
    for (const h of [null, '', 'basura', 'ts=1', 'v1=abc', 'ts=1,v1=zz']) expect(verifyMpSignature({ secret: SECRET, signatureHeader: h, requestId: 'r1', dataId: '1' })).toBe(false)
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: sign('1', 'r1'), requestId: null, dataId: '1' })).toBe(false)
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: sign('1', 'r1'), requestId: 'r1', dataId: null })).toBe(false)
    expect(verifyMpSignature({ secret: '', signatureHeader: sign('1', 'r1', '1', ''), requestId: 'r1', dataId: '1' })).toBe(false)
  })
})

describe('configuración', () => {
  const base = { MP_ACCESS_TOKEN: 't', MP_WEBHOOK_SECRET: 's', APP_URL: 'https://x.com/', MP_ENV: 'test' } as any
  it('normaliza APP_URL y exige variables', () => {
    expect(getMpConfig(base).appUrl).toBe('https://x.com')
    expect(() => getMpConfig({ ...base, MP_ACCESS_TOKEN: '' })).toThrow(MpConfigError)
    expect(() => getMpConfig({ ...base, MP_ENV: 'otro' })).toThrow(MpConfigError)
  })
  it('separa prueba y producción según el entorno de Vercel', () => {
    expect(() => getMpConfig({ ...base, VERCEL_ENV: 'production' })).toThrow(/production/)
    expect(() => getMpConfig({ ...base, VERCEL_ENV: 'preview', MP_ENV: 'production' })).toThrow(/test/)
    expect(getMpConfig({ ...base, VERCEL_ENV: 'production', MP_ENV: 'production' }).env).toBe('production')
    expect(() => getMpConfig({ ...base, MP_ENV: 'production', APP_URL: 'http://x.com' })).toThrow(/https/)
  })
})

describe('estados', () => {
  it('mapea estados de MP', () => {
    expect(mapPaymentStatus('approved')).toBe('reconciled')
    expect(['pending', 'in_process', 'authorized'].map(mapPaymentStatus)).toEqual(['pending', 'pending', 'pending'])
    expect(['rejected', 'cancelled'].map(mapPaymentStatus)).toEqual(['rejected', 'rejected'])
    expect(mapPaymentStatus('charged_back')).toBe('refunded')
    expect(mapPaymentStatus('raro')).toBeNull()
  })
  it('acceso por suscripción', () => {
    const t = '2026-10-14'
    expect(hasAccess(null, t)).toBe(false)
    expect(hasAccess({ status: 'trial', end_date: '2026-10-14' }, t)).toBe(true)
    expect(hasAccess({ status: 'trial', end_date: '2026-10-13' }, t)).toBe(false) // prueba vencida
    expect(hasAccess({ status: 'active', end_date: '2026-11-01' }, t)).toBe(true)
    expect(hasAccess({ status: 'past_due', end_date: '2026-10-20' }, t)).toBe(true) // renovación fallida, período pagado
    expect(hasAccess({ status: 'cancelled', end_date: '2026-10-20' }, t)).toBe(true)
    expect(hasAccess({ status: 'cancelled', end_date: '2026-10-01' }, t)).toBe(false)
    expect(hasAccess({ status: 'suspended', end_date: '2099-01-01' }, t)).toBe(false)
    expect(displayState({ status: 'active', end_date: '2026-01-01' }, t)).toBe('expired')
    expect(displayState({ status: 'suspended', end_date: null }, t)).toBe('suspended')
  })
})

describe('cliente MP', () => {
  it('no filtra el token en los errores y propaga el status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"secret":"x"}', { status: 401 }))
    const c = createMpClient({ accessToken: 'TOKEN-SECRETO', webhookSecret: 's', env: 'test', appUrl: 'https://x.com' }, fetchImpl as any)
    const err = await c.request('GET', '/v1/payments/1').catch((e) => e)
    expect(err).toBeInstanceOf(MpApiError)
    expect(err.status).toBe(401)
    expect(String(err.message)).not.toContain('TOKEN-SECRETO')
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer TOKEN-SECRETO')
  })
})

// ---------- Fakes ----------
const PRO: PlanRow = { id: '11111111-1111-1111-1111-111111111111', name: 'Profesional', price: 9000, billing_period: 'monthly', is_active: true }
const INTENT = '22222222-2222-2222-2222-222222222222'
const SUB = '33333333-3333-3333-3333-333333333333'

function fakeStore(over: Partial<MpStore> & { sub?: Partial<SubRow> | null } = {}) {
  const calls: Record<string, any[]> = {}
  const rec = (k: string, v: any) => (calls[k] ??= []).push(v)
  const sub: SubRow | null = over.sub === null ? null : {
    id: SUB, user_id: 'u1', plan_id: PRO.id, status: 'trial', end_date: '2026-10-20',
    mp_preapproval_id: null, mp_plan_id: null, mp_amount: null, mp_status: null, mp_init_point: null, ...(over.sub ?? {}),
  }
  const store: MpStore = {
    logEvent: async () => 'e1', finishEvent: async () => {},
    getIntent: async (id) => (id === INTENT ? { id, subscription_id: SUB } : null),
    recordPayment: async (a) => { rec('recordPayment', a); return { outcome: 'processed' } },
    getPlan: async (id) => (id === PRO.id ? PRO : null),
    getLatestSubscription: async () => sub,
    createLapsedSubscription: async () => { rec('createLapsed', 1); return { ...(sub as SubRow), id: SUB } },
    findReusableIntent: async () => null,
    createIntent: async (a) => { rec('createIntent', a); return { id: INTENT } },
    setIntentCheckout: async (id, url) => { rec('setIntentCheckout', [id, url]) },
    failIntent: async (id) => { rec('failIntent', id) },
    logIncident: async (entity, id, action, detail) => { rec('logIncident', { entity, id, action, detail }) },
    traceDeletedPayment: async () => null,
    isUserDeletionHeld: async () => false, markIntentUncertain: async (id) => { rec('markIntentUncertain', id) },
    ...over,
  } as MpStore
  return { store, calls }
}
const fakeMp = (routes: Record<string, any>) => {
  const log: any[] = []
  const mp: MpClient = {
    request: async (method, path, body, key) => {
      log.push({ method, path, body, key })
      const r = routes[`${method} ${path}`] ?? routes[`${method} ${path.replace(/\/[^/]+$/, '/*')}`]
      if (r === undefined) throw new MpApiError(404, 'nf')
      if (r instanceof Error) throw r
      return r
    },
  }
  return { mp, log }
}

describe('webhook: procesamiento', () => {
  it('pago aprobado: consulta la API y registra con los datos REALES de MP (no los de la notificación)', async () => {
    const { store, calls } = fakeStore()
    const { mp } = fakeMp({ 'GET /v1/payments/777': { id: 777, status: 'approved', status_detail: 'accredited', external_reference: INTENT, transaction_amount: 9000, currency_id: 'ARS' } })
    const r = await processMpEvent({ mp, store }, { topic: 'payment', dataId: '777' })
    expect(r.outcome).toBe('processed')
    expect(calls.recordPayment[0]).toMatchObject({ intentId: INTENT, externalId: '777', mpStatus: 'approved', amount: 9000, currency: 'ARS' })
  })
  it('ignora pagos inexistentes (notificación de prueba) y referencias ajenas', async () => {
    const { store, calls } = fakeStore()
    expect((await processMpEvent({ mp: fakeMp({}).mp, store }, { topic: 'payment', dataId: '123456' })).outcome).toBe('ignored')
    const m2 = fakeMp({ 'GET /v1/payments/5': { id: 5, status: 'approved', external_reference: 'no-es-uuid', transaction_amount: 1, currency_id: 'ARS' } })
    expect((await processMpEvent({ mp: m2.mp, store }, { topic: 'payment', dataId: '5' })).outcome).toBe('ignored')
    const m3 = fakeMp({ 'GET /v1/payments/6': { id: 6, status: 'approved', external_reference: '99999999-9999-9999-9999-999999999999', transaction_amount: 1, currency_id: 'ARS' } })
    expect((await processMpEvent({ mp: m3.mp, store }, { topic: 'payment', dataId: '6' })).outcome).toBe('ignored')
    expect(calls.recordPayment).toBeUndefined()
    // Un pago con nuestra referencia pero SIN registro local no se pierde en silencio: queda incidencia para conciliar.
    expect(calls.logIncident).toHaveLength(1)
    expect(calls.logIncident[0]).toMatchObject({ action: 'mp_incident_payment_without_local_record', detail: { payment_id: '6', external_reference: '99999999-9999-9999-9999-999999999999' } })
  })
  it('pago posterior a la eliminación de la cuenta: el incidente queda enlazado a la cuenta original (instantánea)', async () => {
    const trace = { found: true, user_id: 'u-borrado', subscription_id: 's-borrada', payment: { payment_id: '99999999-9999-9999-9999-999999999999' } }
    const { store, calls } = fakeStore({ traceDeletedPayment: async (r: string) => (r === '99999999-9999-9999-9999-999999999999' ? trace : null) })
    const m = fakeMp({ 'GET /v1/payments/6': { id: 6, status: 'approved', external_reference: '99999999-9999-9999-9999-999999999999', transaction_amount: 9000, currency_id: 'ARS' } })
    expect((await processMpEvent({ mp: m.mp, store }, { topic: 'payment', dataId: '6' })).outcome).toBe('ignored')
    expect(calls.logIncident[0].detail.deleted_account).toMatchObject({ user_id: 'u-borrado', subscription_id: 's-borrada' })
  })
  it('si el trazado falla, el webhook igual registra el incidente (nunca se pierde el cobro)', async () => {
    const { store, calls } = fakeStore({ traceDeletedPayment: async () => { throw new Error('db down') } })
    const m = fakeMp({ 'GET /v1/payments/6': { id: 6, status: 'approved', external_reference: '99999999-9999-9999-9999-999999999999', transaction_amount: 9000, currency_id: 'ARS' } })
    await processMpEvent({ mp: m.mp, store }, { topic: 'payment', dataId: '6' })
    expect(calls.logIncident).toHaveLength(1); expect(calls.logIncident[0].detail.deleted_account).toBeNull()
  })
  it('errores de negocio de la base ("mp:...") no se reintentan; los demás sí', async () => {
    const pay = { id: 8, status: 'approved', external_reference: INTENT, transaction_amount: 1, currency_id: 'ARS' }
    const biz = fakeStore({ recordPayment: async () => { throw new Error('mp:amount_mismatch') } })
    const r = await processMpEvent({ mp: fakeMp({ 'GET /v1/payments/8': pay }).mp, store: biz.store }, { topic: 'payment', dataId: '8' })
    expect(r).toMatchObject({ outcome: 'rejected', detail: 'mp:amount_mismatch' })
    const down = fakeStore({ recordPayment: async () => { throw new Error('connection reset') } })
    await expect(processMpEvent({ mp: fakeMp({ 'GET /v1/payments/8': pay }).mp, store: down.store }, { topic: 'payment', dataId: '8' })).rejects.toThrow('connection reset')
    await expect(processMpEvent({ mp: fakeMp({ 'GET /v1/payments/8': new MpApiError(503, 'x') }).mp, store: biz.store }, { topic: 'payment', dataId: '8' })).rejects.toBeInstanceOf(MpApiError)
  })
})

describe('registro seguro de fallos de MP', () => {
  const cfg = { accessToken: 'APP_USR-123456789-secreto', webhookSecret: 's', env: 'test' as const, appUrl: 'https://x.com' }
  it('el cliente conserva solo el motivo permitido y saneado (sin token, email ni números largos)', async () => {
    const body = JSON.stringify({ error: 'bad_request', message: 'invalid payer.email juan@mail.com token APP_USR-999999-abc', cause: [{ code: 2000, description: 'back_url invalida' }], secret: 'NO-DEBE-SALIR' })
    const c = createMpClient(cfg, vi.fn().mockResolvedValue(new Response(body, { status: 400 })) as any)
    const err = await c.request('POST', '/checkout/preferences', {}).catch((e) => e)
    expect(err.status).toBe(400)
    expect(err.detail).toContain('error=bad_request')
    expect(err.detail).toContain('back_url invalida')
    for (const bad of ['juan@mail.com', 'APP_USR', 'NO-DEBE-SALIR']) expect(err.detail).not.toContain(bad)
  })
  it('cuerpo no JSON o ilegible: sin detalle y sin romper', async () => {
    const c = createMpClient(cfg, vi.fn().mockResolvedValue(new Response('<html>boom</html>', { status: 500 })) as any)
    const err = await c.request('GET', '/x').catch((e) => e)
    expect(err).toBeInstanceOf(MpApiError); expect(err.status).toBe(500); expect(err.detail).toBeUndefined()
  })
  const deps = (store: MpStore, mp: MpClient) => ({ store, mp, appUrl: 'https://app.test' })
  const U = { userId: 'u1', email: 'cliente@privado.com' }
  const logged = (spy: any) => spy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
  it('rechazo definitivo 4xx: registra tipo, estado HTTP y motivo saneado; el usuario ve el mensaje de siempre', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { store, calls } = fakeStore()
    const { mp } = fakeMp({ 'POST /checkout/preferences': new MpApiError(401, 'Mercado Pago respondió 401 (POST /checkout/preferences)', 'message=invalid access token') })
    await expect(startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toThrow('No pudimos iniciar el pago con Mercado Pago. Probá de nuevo en unos minutos.')
    const out = logged(spy)
    expect(out).toContain('[mp] one_time_failed'); expect(out).toContain('"status":401'); expect(out).toContain('"outcome":"definitive"'); expect(out).toContain('invalid access token')
    expect(out).not.toContain('cliente@privado.com')
    expect(calls.failIntent[0]).toBe(INTENT)
    spy.mockRestore()
  })
  it('resultado incierto: se registra como incierto y la intención NO se marca fallida', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { store, calls } = fakeStore()
    const { mp } = fakeMp({ 'POST /checkout/preferences': new MpApiError(0, 'No se pudo contactar a Mercado Pago (POST /checkout/preferences)') })
    await expect(startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toThrow(/No pudimos confirmar/)
    expect(logged(spy)).toContain('"outcome":"uncertain"')
    expect(calls.failIntent).toBeUndefined(); expect(calls.markIntentUncertain).toEqual([INTENT])
    spy.mockRestore()
  })
  it('un MpApiError construido fuera de MpClient con detail sensible: el log lo sanea igual', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { store } = fakeStore()
    const { mp } = fakeMp({ 'POST /checkout/preferences': new MpApiError(400, 'rechazo', 'payer cliente@privado.com token APP_USR-123456789-secreto Bearer abc.def') })
    await expect(startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toBeInstanceOf(CheckoutError)
    const out = logged(spy)
    expect(out).toContain('"status":400'); expect(out).toContain('[email]'); expect(out).toContain('[token]')
    for (const bad of ['cliente@privado.com', 'APP_USR', 'secreto', 'abc.def']) expect(out).not.toContain(bad)
    spy.mockRestore()
  })
  it('error no-MP (p. ej. base de datos): se registra saneado sin emails ni tokens', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { store } = fakeStore({ setIntentCheckout: async () => { throw new Error('fallo para cliente@privado.com con Bearer abc.def') } })
    const { mp } = fakeMp({ 'POST /checkout/preferences': { init_point: 'https://mp/pay' } })
    await expect(startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toBeInstanceOf(CheckoutError)
    const out = logged(spy)
    expect(out).toContain('"kind":"error"'); expect(out).toContain('[email]'); expect(out).not.toContain('cliente@privado.com'); expect(out).not.toContain('abc.def')
    spy.mockRestore()
  })
})

describe('checkout: back_urls con APP_URL sucia en Vercel', () => {
  const ORIGIN = 'https://oficioclaro.vercel.app'
  const mk = (APP_URL: string) => getMpConfig({ MP_ACCESS_TOKEN: 't', MP_WEBHOOK_SECRET: 's', MP_ENV: 'test', VERCEL_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: 'true', APP_URL } as any)
  it.each([ORIGIN, `${ORIGIN}/`, `${ORIGIN} `, `${ORIGIN}\n`, `"${ORIGIN}"`, `${ORIGIN}/app/`])('APP_URL %j → el checkout envía a MP las tres back_urls exactas y válidas', async (raw) => {
    const { store } = fakeStore()
    const { mp, log } = fakeMp({ 'POST /checkout/preferences': { init_point: 'https://mp/pay' } })
    await startCheckout({ store, mp, appUrl: mk(raw).appUrl }, { userId: 'u1', email: null, planId: PRO.id, mode: 'one_time' })
    const body = log[0].body
    expect(body.back_urls).toEqual({
      success: `${ORIGIN}/?vista=suscripcion&mp=ok`,
      pending: `${ORIGIN}/?vista=suscripcion&mp=pending`,
      failure: `${ORIGIN}/?vista=suscripcion&mp=error`,
    })
    for (const u of Object.values(body.back_urls) as string[]) {
      const p = new URL(u)
      expect(p.protocol).toBe('https:'); expect(p.origin).toBe(ORIGIN); expect(p.pathname).toBe('/'); expect(u).not.toMatch(/\s|"/)
    }
    expect(body.auto_return).toBe('approved')
    expect(body.notification_url).toBe(`${ORIGIN}/api/mercadopago/webhook`)
  })
})

describe('checkout', () => {
  const deps = (store: MpStore, mp: MpClient) => ({ store, mp, appUrl: 'https://app.test' })
  const U = { userId: 'u1', email: 'a@b.com' }

  it('pago manual: el monto sale de la base, la referencia es la operación local', async () => {
    const { store, calls } = fakeStore()
    const { mp, log } = fakeMp({ 'POST /checkout/preferences': { init_point: 'https://mp/pay' } })
    const r = await startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })
    expect(r.url).toBe('https://mp/pay')
    expect(calls.createIntent[0]).toMatchObject({ planId: PRO.id, amount: 9000 })
    expect(log[0].body.items[0].unit_price).toBe(9000)
    expect(log[0].body.external_reference).toBe(INTENT)
    expect(log[0].body.notification_url).toBe('https://app.test/api/mercadopago/webhook')
    expect(log[0].key).toBe(INTENT)
    expect(calls.setIntentCheckout[0]).toEqual([INTENT, 'https://mp/pay'])
  })
  it('rechaza plan inexistente, inactivo, con id manipulado o cuenta suspendida', async () => {
    const { store } = fakeStore()
    const { mp, log } = fakeMp({})
    await expect(startCheckout(deps(store, mp), { ...U, planId: '99999999-9999-9999-9999-999999999999', mode: 'one_time' })).rejects.toBeInstanceOf(CheckoutError)
    await expect(startCheckout(deps(store, mp), { ...U, planId: "x'; drop table plans;--", mode: 'one_time' })).rejects.toBeInstanceOf(CheckoutError)
    const inactive = fakeStore({ getPlan: async () => ({ ...PRO, is_active: false }) })
    await expect(startCheckout(deps(inactive.store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toBeInstanceOf(CheckoutError)
    const susp = fakeStore({ sub: { status: 'suspended' } })
    await expect(startCheckout(deps(susp.store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toThrow(/suspendida/)
    expect(log).toHaveLength(0)
  })
  it('reintento: reutiliza el enlace pendiente sin crear otra operación', async () => {
    const { store, calls } = fakeStore({ findReusableIntent: async () => ({ id: INTENT, checkout_url: 'https://mp/previo' }) })
    const { mp, log } = fakeMp({})
    expect((await startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).url).toBe('https://mp/previo')
    expect(calls.createIntent).toBeUndefined(); expect(log).toHaveLength(0)
  })
  it('MP rechaza definitivamente (4xx): la operación local queda fallida y el error es genérico', async () => {
    const { store, calls } = fakeStore()
    const { mp } = fakeMp({ 'POST /checkout/preferences': new MpApiError(400, 'bad request') })
    await expect(startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toBeInstanceOf(CheckoutError)
    expect(calls.failIntent[0]).toBe(INTENT); expect(calls.markIntentUncertain).toBeUndefined()
  })
  it.each([[0, 'timeout / red'], [500, 'error 5xx'], [408, 'request timeout'], [429, 'límite de tasa']])(
    'TIMEOUT / resultado incierto de MP (%s, %s): la intención se CONSERVA pendiente y marcada incierta; nunca se da por fallida', async (status) => {
      const { store, calls } = fakeStore()
      const { mp } = fakeMp({ 'POST /checkout/preferences': new MpApiError(status as number, 'incierto') })
      await expect(startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toThrow(/No pudimos confirmar/)
      expect(calls.failIntent).toBeUndefined(); expect(calls.markIntentUncertain).toEqual([INTENT])
    })
  it('MP respondió 2xx pero falló guardar el enlace: incierto (la preferencia existe), no fallido', async () => {
    const { store, calls } = fakeStore({ setIntentCheckout: async () => { throw new Error('db down') } })
    const { mp } = fakeMp({ 'POST /checkout/preferences': { init_point: 'https://mp/pay' } })
    await expect(startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toBeInstanceOf(CheckoutError)
    expect(calls.failIntent).toBeUndefined(); expect(calls.markIntentUncertain).toEqual([INTENT])
  })
  it('6) cuenta SIN suscripción con eliminación en curso: el checkout falla rápido y NO crea la suscripción vencida ni la intención', async () => {
    const { store, calls } = fakeStore({ getLatestSubscription: async () => null, isUserDeletionHeld: async () => true })
    const { mp, log } = fakeMp({})
    await expect(startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toBeInstanceOf(CheckoutError)
    expect(calls.createLapsed).toBeUndefined(); expect(calls.createIntent).toBeUndefined(); expect(log).toHaveLength(0)
  })
  it('6b) cuenta sin suscripción: si la retención aparece justo al crear la suscripción, la base rechaza y el checkout falla sin tocar MP', async () => {
    const { RenewalsBlockedError } = await import('./store')
    const { store, calls } = fakeStore({ getLatestSubscription: async () => null, createLapsedSubscription: async () => { throw new RenewalsBlockedError('mp:renewals_blocked') } })
    const { mp, log } = fakeMp({})
    await expect(startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })).rejects.toBeInstanceOf(CheckoutError)
    expect(calls.createIntent).toBeUndefined(); expect(log).toHaveLength(0)
  })
  it('usuario sin suscripción: se le crea una vencida (sin acceso) antes de cobrar', async () => {
    const { store, calls } = fakeStore({ getLatestSubscription: async () => null })
    const { mp } = fakeMp({ 'POST /checkout/preferences': { init_point: 'https://mp/pay' } })
    await startCheckout(deps(store, mp), { ...U, planId: PRO.id, mode: 'one_time' })
    expect(calls.createLapsed).toHaveLength(1)
  })
})

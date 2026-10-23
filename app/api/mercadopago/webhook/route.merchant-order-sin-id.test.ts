import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { WebhookSignatureValidator } from '@/lib/mercadopago/__reference__/sdk-webhook-validator'

// Prueba diagnóstica: avisos `merchant_order` SIN data.id (query ni cuerpo), como los observados con mp_env=test.
// Se compara la decisión de nuestra ruta con la del validador OFICIAL del SDK (copia de referencia) para las mismas solicitudes.
// Son pruebas locales: no demuestran qué firma Mercado Pago en producción; solo que, SI firma sin id, ahora lo validamos igual que el SDK.
const processMock = vi.fn()
const store = { logEvent: vi.fn(async (..._a: any[]) => 'ev1' as string | null), finishEvent: vi.fn(async (..._a: any[]) => {}) }
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/mercadopago/store', () => ({ createSupabaseMpStore: () => store }))
vi.mock('@/lib/mercadopago/process-event', () => ({ processMpEvent: (...a: any[]) => processMock(...a) }))
import { POST } from './route'

const SECRET = 'whsec-test-ipn', RID = 'f1c2-request-id', TS = '1761181234567'
const manifest = (id: string | undefined, rid: string | undefined, ts = TS) =>
  [id ? `id:${id}` : '', rid ? `request-id:${rid}` : '', `ts:${ts}`].filter(Boolean).join(';') + ';'
const hdr = (o: { id?: string; rid?: string; ts?: string; secret?: string } = {}) => {
  const ts = o.ts ?? TS, rid = 'rid' in o ? o.rid : RID
  return `ts=${ts},v1=${createHmac('sha256', o.secret ?? SECRET).update(manifest(o.id, rid, ts)).digest('hex')}`
}
const sdkAccepts = (h: string | null, rid: string | null, id: string | null) => {
  try { WebhookSignatureValidator.validate({ xSignature: h, xRequestId: rid, dataId: id, secret: SECRET }); return true } catch { return false }
}
const IPN_QS = 'id=45481702722&topic=merchant_order'
const call = (qs: string, headers: Record<string, string>, body: unknown = {}) =>
  POST(new NextRequest(`https://app.test/api/mercadopago/webhook?${qs}`, { method: 'POST', headers, body: JSON.stringify(body) }))

let fetchSpy: ReturnType<typeof vi.fn>, raw: string[]
beforeEach(() => {
  raw = []; processMock.mockReset(); store.logEvent.mockClear(); store.finishEvent.mockClear()
  fetchSpy = vi.fn(async () => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetchSpy)
  Object.assign(process.env, { MP_ACCESS_TOKEN: 'APP_USR-tok', MP_WEBHOOK_SECRET: SECRET, APP_URL: 'https://app.test', MP_ENV: 'test' }); delete process.env.VERCEL_ENV
  vi.spyOn(console, 'error').mockImplementation((...c: unknown[]) => { raw.push(c.join(' ')) })
  vi.spyOn(console, 'info').mockImplementation((...c: unknown[]) => { raw.push(c.join(' ')) })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const traces = () => raw.filter((l) => l.startsWith('[MP_WEBHOOK_TRACE]')).map((l) => JSON.parse(l.slice(19)))

describe('merchant_order sin data.id (como los observados en mp_env=test)', () => {
  it.each([
    ['cuerpo vacío', {}],
    ['cuerpo IPN típico (resource + topic, sin data.id)', { resource: 'https://api.mercadolibre.com/merchant_orders/45481702722', topic: 'merchant_order' }],
  ])('firma válida con manifest sin id (%s): el SDK oficial la acepta y nosotros respondemos 200 «ignored» sin procesar nada', async (_n, body) => {
    const h = hdr()
    expect(sdkAccepts(h, RID, null)).toBe(true) // referencia oficial
    const res = await call(IPN_QS, { 'x-signature': h, 'x-request-id': RID }, body)
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ ok: true, outcome: 'ignored' })
    expect(processMock).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled() // ni consulta a MP ni procesamiento
    expect(store.logEvent).toHaveBeenCalledWith({ topic: 'merchant_order', dataId: null, requestId: RID })
    expect(store.finishEvent).toHaveBeenCalledWith('ev1', 'ignored', expect.stringContaining('merchant_order sin data.id'))
    const t = traces()
    expect(t.map((l) => l.etapa)).toEqual(['entrada', 'firma', 'evento', 'persistencia', 'procesamiento', 'salida'])
    expect(t[1]).toMatchObject({ resultado: 'aceptada', mp_env: 'test', manifest: { plantilla: 'request-id:<x-request-id>;ts:<ts de x-signature>;', id: { presente: false } } })
    expect(t[2]).toMatchObject({ resultado: 'ignorado_merchant_order_sin_data_id' }); expect(t[5]).toMatchObject({ http: 200 })
    for (const bad of ['45481702722', RID, 'APP_USR', h.slice(h.indexOf('v1=') + 3)]) expect(JSON.stringify(t)).not.toContain(bad)
  })
  it('también con `type=merchant_order` en lugar de `topic`: mismo resultado', async () => {
    expect((await call('id=1&type=merchant_order', { 'x-signature': hdr(), 'x-request-id': RID })).status).toBe(200)
  })
  it('firma que NO coincide (secreto distinto): SDK rechaza y nosotros 401; nada se registra ni se procesa', async () => {
    const h = hdr({ secret: 'otro-secreto' })
    expect(sdkAccepts(h, RID, null)).toBe(false)
    const res = await call(IPN_QS, { 'x-signature': h, 'x-request-id': RID })
    expect(res.status).toBe(401); expect(processMock).not.toHaveBeenCalled(); expect(store.logEvent).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled()
    expect(traces().find((l) => l.etapa === 'firma')).toMatchObject({ categoria: 'firma_no_coincide', motivo: 'hmac_distinto_manifest_sin_id' })
  })
  it('ts manipulado: SDK rechaza y nosotros 401', async () => {
    const h = hdr().replace(`ts=${TS}`, `ts=${Number(TS) + 1}`)
    expect(sdkAccepts(h, RID, null)).toBe(false)
    expect((await call(IPN_QS, { 'x-signature': h, 'x-request-id': RID })).status).toBe(401)
  })
  it('request-id distinto al firmado: SDK rechaza y nosotros 401', async () => {
    const h = hdr()
    expect(sdkAccepts(h, 'otro-id', null)).toBe(false)
    expect((await call(IPN_QS, { 'x-signature': h, 'x-request-id': 'otro-id' })).status).toBe(401)
  })
  it('firma calculada con el `id` del IPN como si fuera data.id: NO se acepta (no se inventa un ID)', async () => {
    const h = hdr({ id: '45481702722' })
    expect(sdkAccepts(h, RID, null)).toBe(false) // el SDK, sin data.id, tampoco la acepta
    expect((await call(IPN_QS, { 'x-signature': h, 'x-request-id': RID })).status).toBe(401)
  })
  it('sin x-signature o con x-signature malformada: 401 (se sigue exigiendo ts y v1)', async () => {
    for (const h of [undefined, 'basura', 'ts=1', `v1=${'a'.repeat(64)}`, 'ts=1,v1=corta']) {
      const headers: Record<string, string> = { 'x-request-id': RID }; if (h) headers['x-signature'] = h
      expect(sdkAccepts(h ?? null, RID, null), String(h)).toBe(false)
      expect((await call(IPN_QS, headers)).status, String(h)).toBe(401)
    }
    expect(processMock).not.toHaveBeenCalled()
  })
  it('sin x-request-id: el SDK acepta (lo omite) pero nosotros seguimos exigiéndolo (más estrictos a propósito): 401', async () => {
    const h = hdr({ rid: undefined })
    expect(sdkAccepts(h, null, null)).toBe(true)
    expect((await call(IPN_QS, { 'x-signature': h })).status).toBe(401)
  })
})

describe('la excepción NO se extiende a otros casos', () => {
  const noId = (qs: string, body: unknown = {}) => call(qs, { 'x-signature': hdr(), 'x-request-id': RID }, body)
  it('payment sin data.id con firma válida sin id (el SDK la aceptaría): 401, nada se procesa', async () => {
    expect(sdkAccepts(hdr(), RID, null)).toBe(true)
    expect((await noId('type=payment')).status).toBe(401); expect((await noId('id=1&topic=payment')).status).toBe(401)
    expect(processMock).not.toHaveBeenCalled(); expect(store.logEvent).not.toHaveBeenCalled()
  })
  it.each(['subscription_preapproval', 'subscription_authorized_payment', 'topic_merchant_order_wh', 'otro', ''])('tópico «%s» sin data.id: 401', async (tp) => {
    expect((await noId(tp ? `type=${tp}` : 'x=1')).status).toBe(401); expect(processMock).not.toHaveBeenCalled()
  })
  it('merchant_order con data.id solo en el CUERPO (no en la query): 401, el cuerpo no sustituye a la query aunque la firma sea válida sin id', async () => {
    expect((await noId(IPN_QS, { data: { id: '45481702722' } })).status).toBe(401); expect(processMock).not.toHaveBeenCalled(); expect(store.logEvent).not.toHaveBeenCalled()
  })
  it('merchant_order CON data.id en la query: sigue el flujo normal de siempre (no la excepción)', async () => {
    processMock.mockResolvedValue({ outcome: 'ignored', detail: 'topic no manejado' })
    const res = await call('data.id=777&type=merchant_order', { 'x-signature': hdr({ id: '777' }), 'x-request-id': RID }, { data: { id: '777' } })
    expect(res.status).toBe(200); expect(processMock).toHaveBeenCalledTimes(1); expect(processMock.mock.calls[0][1]).toEqual({ topic: 'merchant_order', dataId: '777' })
  })
  it('simulación del panel (data.id "123456" en query y cuerpo): comportamiento de siempre', async () => {
    processMock.mockResolvedValue({ outcome: 'ignored' })
    const res = await call('data.id=123456&type=payment', { 'x-signature': hdr({ id: '123456' }), 'x-request-id': RID }, { action: 'payment.updated', api_version: 'v1', data: { id: '123456' }, live_mode: false, type: 'payment' })
    expect(res.status).toBe(200); expect(processMock.mock.calls[0][1]).toEqual({ topic: 'payment', dataId: '123456' })
  })
})

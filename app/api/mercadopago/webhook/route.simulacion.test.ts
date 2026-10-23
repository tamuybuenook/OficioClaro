import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

// Reproduce la forma de las solicitudes de Mercado Pago (simulación del panel y notificaciones reales) contra la ruta real.
// Referencia de manifest: SDK oficial mercadopago/sdk-nodejs (src/utils/webhook, commit bf920b9): `id:<data.id de la query>;request-id:<x-request-id>;ts:<ts>;`
// y «los pares cuyo valor falta se omiten». Cada caso marcado [DIVERGENCIA] documenta el comportamiento ACTUAL de OficioClaro, que NO coincide con el SDK.
// Estas pruebas son locales: demuestran lo que hace nuestro código, no lo que Mercado Pago envía en producción.
const processMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/mercadopago/store', () => ({ createSupabaseMpStore: () => ({ logEvent: async () => 'e', finishEvent: async () => {} }) }))
vi.mock('@/lib/mercadopago/process-event', () => ({ processMpEvent: (...a: any[]) => processMock(...a) }))
import { POST } from './route'

const SECRET = 'whsec-simulacion', RID = 'rid-sim-1', TS = '1742505638683'
const sdkManifest = (id: string | undefined, rid: string | undefined, ts: string) =>
  [id ? `id:${id}` : '', rid ? `request-id:${rid}` : '', `ts:${ts}`].filter(Boolean).join(';') + ';'
const header = (id: string | undefined, rid: string | undefined = RID) =>
  `ts=${TS},v1=${createHmac('sha256', SECRET).update(sdkManifest(id, rid, TS)).digest('hex')}`
// Cuerpo típico de la simulación del panel (forma documentada; los valores son inventados).
const simBody = (id: string, extra: Record<string, unknown> = {}) => ({ action: 'payment.updated', api_version: 'v1', data: { id }, date_created: '2021-11-01T02:02:02Z', id: 123456, live_mode: false, type: 'payment', user_id: 1 , ...extra })
const call = (qs: string, headers: Record<string, string>, body: unknown) =>
  POST(new NextRequest(`https://app.test/api/mercadopago/webhook?${qs}`, { method: 'POST', headers, body: JSON.stringify(body) }))

beforeEach(() => {
  processMock.mockReset(); processMock.mockResolvedValue({ outcome: 'ignored' })
  Object.assign(process.env, { MP_ACCESS_TOKEN: 't', MP_WEBHOOK_SECRET: SECRET, APP_URL: 'https://app.test', MP_ENV: 'test' }); delete process.env.VERCEL_ENV
  vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('payment (id numérico): igual que el SDK', () => {
  it('simulación del panel: data.id en la query Y en el cuerpo, firmada con el id de la query → 200', async () => {
    const res = await call('data.id=123456&type=payment', { 'x-signature': header('123456'), 'x-request-id': RID }, simBody('123456'))
    expect(res.status).toBe(200); expect(processMock.mock.calls[0][1]).toEqual({ topic: 'payment', dataId: '123456' })
  })
  it('data.id en el CUERPO y AUSENTE en la query, firma calculada con el id del cuerpo: 401 (la query es la única fuente del manifest; el cuerpo no es intercambiable)', async () => {
    const res = await call('type=payment', { 'x-signature': header('123456'), 'x-request-id': RID }, simBody('123456'))
    expect(res.status).toBe(401); expect(processMock).not.toHaveBeenCalled()
  })
  it('data.id en el cuerpo y ausente en la query, pero firma calculada SIN id (manifest SDK con id omitido): hoy se rechaza por falta_data_id antes de calcular [DIVERGENCIA]', async () => {
    const res = await call('type=payment', { 'x-signature': header(undefined), 'x-request-id': RID }, simBody('123456'))
    expect(res.status).toBe(401) // el SDK oficial calcularía `request-id:…;ts:…;` y aceptaría esta firma
    expect(processMock).not.toHaveBeenCalled()
  })
  it('cuerpo con id distinto al de la query: nunca se mezclan (400)', async () => {
    expect((await call('data.id=111&type=payment', { 'x-signature': header('111'), 'x-request-id': RID }, simBody('222'))).status).toBe(400)
  })
})

describe('merchant_order', () => {
  it('IPN clásico (?id=…&topic=merchant_order) con firma calculada sin id (manifest SDK con id omitido): hoy 401 falta_data_id [DIVERGENCIA]', async () => {
    const res = await call('id=45481702722&topic=merchant_order', { 'x-signature': header(undefined), 'x-request-id': RID }, {})
    expect(res.status).toBe(401) // el SDK aceptaría; el resultado de negocio sería «ignorado» (processMpEvent no maneja merchant_order)
    expect(processMock).not.toHaveBeenCalled()
  })
  it('el `id` de la query IPN NO es data.id: una firma calculada con ese id se rechaza', async () => {
    expect((await call('id=45481702722&topic=merchant_order', { 'x-signature': header('45481702722'), 'x-request-id': RID }, {})).status).toBe(401)
  })
  it('webhook de merchant_order con data.id en la query: firma válida → se procesa y queda «ignored» por tópico no manejado', async () => {
    const res = await call('data.id=45481702722&type=topic_merchant_order_wh', { 'x-signature': header('45481702722'), 'x-request-id': RID }, { type: 'topic_merchant_order_wh', data: { id: '45481702722' } })
    expect(res.status).toBe(200); expect(processMock.mock.calls[0][1]).toEqual({ topic: 'topic_merchant_order_wh', dataId: '45481702722' })
  })
})

describe('subscription_preapproval (id alfanumérico)', () => {
  const ID = '2c938084726fca480172750000000000'
  it('id hex en minúsculas en la query: firma válida → 200 (igual que el SDK)', async () => {
    const res = await call(`data.id=${ID}&type=subscription_preapproval`, { 'x-signature': header(ID), 'x-request-id': RID }, { type: 'subscription_preapproval', data: { id: ID } })
    expect(res.status).toBe(200); expect(processMock.mock.calls[0][1]).toEqual({ topic: 'subscription_preapproval', dataId: ID })
  })
  it('id con MAYÚSCULAS en la query y firma con el id tal cual (SDK): hoy 401 porque firmamos en minúsculas [DIVERGENCIA]', async () => {
    const up = 'ABC123DEF456'
    expect((await call(`data.id=${up}&type=subscription_preapproval`, { 'x-signature': header(up), 'x-request-id': RID }, {})).status).toBe(401)
  })
  it('id con MAYÚSCULAS y firma con el id en minúsculas (regla antigua de MP): hoy 200', async () => {
    const up = 'ABC123DEF456'
    expect((await call(`data.id=${up}&type=subscription_preapproval`, { 'x-signature': header(up.toLowerCase()), 'x-request-id': RID }, {})).status).toBe(200)
  })
})

describe('request-id ausente', () => {
  it('firma calculada sin request-id (manifest SDK con request-id omitido): hoy 401 falta_x_request_id [DIVERGENCIA]', async () => {
    expect((await call('data.id=123&type=payment', { 'x-signature': header('123', undefined) }, simBody('123'))).status).toBe(401)
  })
})

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

// MODO SOLO RECEPCIÓN: 200 confirma LLEGADA, nunca aprobación. Todo con datos sintéticos; no se contacta a Mercado Pago ni a la base.
// El store simulado SOLO permite logEvent/finishEvent: tocar cualquier otro método (pagos, suscripciones, accesos, incidentes) lanza y rompe la prueba.
const h = vi.hoisted(() => {
  const state = { logEvent: [] as any[], finishEvent: [] as any[], forbidden: [] as string[], adminFails: false }
  const store = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === 'logEvent') return async (e: any) => { state.logEvent.push(e); return 'evt-1' }
      if (prop === 'finishEvent') return async (id: any, outcome: string, detail?: string) => { state.finishEvent.push({ id, outcome, detail }) }
      if (prop === 'then') return undefined
      state.forbidden.push(String(prop))
      throw new Error(`método prohibido en modo solo recepción: ${String(prop)}`)
    },
  })
  return { state, store }
})
const processMock = vi.fn()
const mpClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { if (h.state.adminFails) throw new Error('db caída'); return {} } }))
vi.mock('@/lib/mercadopago/store', () => ({ createSupabaseMpStore: () => h.store }))
vi.mock('@/lib/mercadopago/process-event', () => ({ processMpEvent: (...a: any[]) => processMock(...a) }))
vi.mock('@/lib/mercadopago/client', async (orig) => ({ ...(await orig<any>()), createMpClient: (...a: any[]) => mpClientMock(...a) }))

import { POST } from './route'
import { isReceiptOnlyMode } from '@/lib/mercadopago/receipt-only'

const SECRET = 'sec-sintetico-ZZ9'
const RID = 'req-sintetico-0001'
const req = (qs: string, headers: Record<string, string> = {}, body = '{}') =>
  new NextRequest(`https://app.test/api/mercadopago/webhook?${qs}`, { method: 'POST', headers, body })
const sigFor = (manifest: string, ts = '1700000000') => `ts=${ts},v1=${createHmac('sha256', SECRET).update(manifest).digest('hex')}`
const validSig = (id: string, rid = RID, ts = '1700000000') => sigFor(`id:${id};request-id:${rid};ts:${ts};`, ts)
const BAD_SIG = 'ts=1700000000,v1=' + 'a'.repeat(64)

const setEnv = (e: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(e)) v === undefined ? delete process.env[k] : (process.env[k] = v) }
beforeEach(() => {
  processMock.mockReset(); mpClientMock.mockReset()
  h.state.logEvent.length = 0; h.state.finishEvent.length = 0; h.state.forbidden.length = 0; h.state.adminFails = false
  setEnv({ MP_ACCESS_TOKEN: 'tok-sintetico', MP_WEBHOOK_SECRET: SECRET, APP_URL: 'https://app.test', MP_ENV: 'test', MP_WEBHOOK_RECEIPT_ONLY: 'true', MP_ALLOW_TEST_IN_PRODUCTION: undefined, VERCEL_ENV: undefined })
})
afterEach(() => { setEnv({ MP_WEBHOOK_RECEIPT_ONLY: undefined, VERCEL_ENV: undefined, MP_ALLOW_TEST_IN_PRODUCTION: undefined }) })

const expectNothingProcessed = () => {
  expect(processMock).not.toHaveBeenCalled()
  expect(mpClientMock).not.toHaveBeenCalled()
  expect(h.state.forbidden).toEqual([]) // ni pagos, ni suscripciones, ni accesos, ni incidentes
}
const expectReceivedUnverified = async (res: Response, verified = false) => {
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, outcome: 'received_unverified', verified, processed: false })
  expect(h.state.finishEvent).toHaveLength(1)
  expect(h.state.finishEvent[0].outcome).toBe('received_unverified')
}

describe('modo solo recepción ACTIVO (MP_ENV=test + MP_WEBHOOK_RECEIPT_ONLY=true)', () => {
  it('IPN de payment sin data.id (como los de los logs): 200 «recibido sin verificar»; no se procesa nada; nunca se registra el id', async () => {
    const res = await POST(req('id=987654321&topic=payment', { 'x-signature': BAD_SIG, 'x-request-id': RID }))
    await expectReceivedUnverified(res)
    expectNothingProcessed()
    expect(h.state.logEvent[0]).toEqual({ topic: 'payment', dataId: null, requestId: RID }) // el id de IPN no verificado NO se guarda
    expect(h.state.finishEvent[0].detail).toContain('formato=ipn')
    expect(h.state.finishEvent[0].detail).toContain('firma_verificada=false')
  })
  it('IPN de merchant_order sin data.id con firma que no coincide: 200 recibido, sin procesar', async () => {
    await expectReceivedUnverified(await POST(req('id=555&topic=merchant_order', { 'x-signature': BAD_SIG, 'x-request-id': RID })))
    expectNothingProcessed()
  })
  it('sin data.id (webhook, no IPN): 200 recibido, razón falta_data_id', async () => {
    await expectReceivedUnverified(await POST(req('type=payment', { 'x-signature': BAD_SIG, 'x-request-id': RID })))
    expect(h.state.finishEvent[0].detail).toContain('razón=falta_data_id')
    expectNothingProcessed()
  })
  it('sin x-request-id: 200 recibido, razón falta_x_request_id', async () => {
    await expectReceivedUnverified(await POST(req('data.id=1&type=payment', { 'x-signature': BAD_SIG })))
    expect(h.state.finishEvent[0].detail).toContain('razón=falta_x_request_id')
    expectNothingProcessed()
  })
  it('sin x-signature: 200 recibido, razón falta_x_signature', async () => {
    await expectReceivedUnverified(await POST(req('data.id=1&type=payment', { 'x-request-id': RID })))
    expect(h.state.finishEvent[0].detail).toContain('razón=falta_x_signature')
    expectNothingProcessed()
  })
  it('con data.id y firma INVÁLIDA: 200 recibido; no se confía en el data.id ni se procesa', async () => {
    await expectReceivedUnverified(await POST(req('data.id=123456&type=payment', { 'x-signature': BAD_SIG, 'x-request-id': RID })))
    expect(h.state.logEvent[0].dataId).toBeNull()
    expectNothingProcessed()
  })
  it('firma calculada con el id del IPN como si fuera data.id: sigue sin verificarse (no se inventa un id): recibido, sin procesar', async () => {
    const res = await POST(req('id=777&topic=payment', { 'x-signature': validSig('777'), 'x-request-id': RID }))
    await expectReceivedUnverified(res)
    expect(h.state.finishEvent[0].detail).toContain('firma_verificada=false')
    expectNothingProcessed()
  })
  it('ids contradictorios (query ≠ cuerpo) aunque la firma sea válida para la query: 200 recibido, verified=true, processed=false, nada se procesa', async () => {
    const res = await POST(req('data.id=1&type=payment', { 'x-signature': validSig('1'), 'x-request-id': RID }, JSON.stringify({ data: { id: '2' } })))
    await expectReceivedUnverified(res, true)
    expect(h.state.finishEvent[0].detail).toContain('razón=ids_contradictorios')
    expectNothingProcessed()
  })
  it('request-id con formato raro (inyección) no se copia al registro', async () => {
    await POST(req('type=payment', { 'x-signature': BAD_SIG, 'x-request-id': 'a b;<script>' }))
    expect(h.state.logEvent[0].requestId).toBeNull()
  })
  it('si no se puede guardar el registro: igual 200 (recepción), sin procesar y sin filtrar el motivo', async () => {
    h.state.adminFails = true
    const res = await POST(req('id=1&topic=payment', { 'x-signature': BAD_SIG, 'x-request-id': RID }))
    expect(res.status).toBe(200); expect((await res.json()).processed).toBe(false)
    expectNothingProcessed()
  })
  it('los logs no contienen secreto, token, firma completa, request-id ni identificadores', async () => {
    const spies = (['info', 'error'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined))
    await POST(req('id=987654321&topic=payment', { 'x-signature': BAD_SIG, 'x-request-id': RID }))
    const out = spies.flatMap((s) => s.mock.calls.map((c) => c.join(' '))).join('\n'); spies.forEach((s) => s.mockRestore())
    expect(out).toContain('solo_recepcion')
    for (const secreto of [SECRET, 'tok-sintetico', 'a'.repeat(64), RID, '987654321']) expect(out).not.toContain(secreto)
  })
  it('el diagnóstico de manifest en logs solo trae booleanos y NO cambia la decisión', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // Firma hecha con el id del IPN: el diagnóstico lo detecta (para saber que el secreto es correcto) pero NO se acepta.
    const res = await POST(req('id=777&topic=payment', { 'x-signature': validSig('777'), 'x-request-id': RID }))
    const out = spy.mock.calls.map((c) => c.join(' ')).join('\n'); spy.mockRestore()
    expect(out).toContain('"diagnostico_manifest":{"solo_diagnostico":true,"sin_id":false,"con_id_ipn":true')
    expect((await res.json()).verified).toBe(false)
  })
  it('firma VÁLIDA con data.id: NO es modo recepción; sigue el flujo normal y procesa', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' })
    mpClientMock.mockReturnValue({ request: vi.fn() })
    const res = await POST(req('data.id=42&type=payment', { 'x-signature': validSig('42'), 'x-request-id': RID }))
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ ok: true, outcome: 'processed' })
    expect(processMock).toHaveBeenCalledTimes(1)
    expect(processMock.mock.calls[0][1]).toEqual({ topic: 'payment', dataId: '42' })
  })
})

describe('aislamiento: el modo recepción NO existe fuera de la condición exacta', () => {
  const unverified = () => POST(req('id=1&topic=payment', { 'x-signature': BAD_SIG, 'x-request-id': RID }))
  it('MP_ENV=test pero sin la variable: 401 como siempre', async () => {
    setEnv({ MP_WEBHOOK_RECEIPT_ONLY: undefined })
    const res = await unverified(); expect(res.status).toBe(401); expect(await res.json()).toEqual({ error: 'invalid_signature' })
    expect(h.state.logEvent).toHaveLength(0); expectNothingProcessed()
  })
  it.each(['TRUE', 'True', '1', 'yes', ' true', 'true ', 'false', ''])('valor «%s»: solo el texto exacto "true" activa; este no → 401', async (v) => {
    setEnv({ MP_WEBHOOK_RECEIPT_ONLY: v })
    expect((await unverified()).status).toBe(401); expect(h.state.logEvent).toHaveLength(0)
  })
  it('MP_ENV=production con la variable en true: IMPOSIBLE activarlo → 401 (producción jamás acepta una firma sin validar)', async () => {
    setEnv({ MP_ENV: 'production', VERCEL_ENV: 'production', MP_WEBHOOK_RECEIPT_ONLY: 'true' })
    const res = await unverified(); expect(res.status).toBe(401)
    expect((await POST(req('data.id=1&type=payment', { 'x-signature': BAD_SIG, 'x-request-id': RID }))).status).toBe(401)
    expect(h.state.logEvent).toHaveLength(0); expectNothingProcessed()
  })
  it('Production de Vercel con MP_ENV=test SIN autorización explícita: la configuración se rechaza (500), nunca se acepta', async () => {
    setEnv({ VERCEL_ENV: 'production', MP_WEBHOOK_RECEIPT_ONLY: 'true' })
    expect((await unverified()).status).toBe(500); expect(h.state.logEvent).toHaveLength(0)
  })
  it('Production de Vercel con MP_ENV=test Y MP_ALLOW_TEST_IN_PRODUCTION=true Y la variable (el caso de prueba real): activo, sigue sin procesar nada', async () => {
    setEnv({ VERCEL_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: 'true' })
    await expectReceivedUnverified(await unverified()); expectNothingProcessed()
  })
  it('isReceiptOnlyMode: tabla de verdad', () => {
    const on = { MP_WEBHOOK_RECEIPT_ONLY: 'true' } as unknown as NodeJS.ProcessEnv
    expect(isReceiptOnlyMode('test', on)).toBe(true)
    expect(isReceiptOnlyMode('production', on)).toBe(false)
    expect(isReceiptOnlyMode('test', {} as unknown as NodeJS.ProcessEnv)).toBe(false)
    expect(isReceiptOnlyMode('test', { MP_WEBHOOK_RECEIPT_ONLY: 'TRUE' } as unknown as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe('producción y flujo verificado: duplicados y errores (sin modo recepción)', () => {
  beforeEach(() => setEnv({ MP_WEBHOOK_RECEIPT_ONLY: undefined }))
  const signed = (id = '42') => req(`data.id=${id}&type=payment`, { 'x-signature': validSig(id), 'x-request-id': RID })
  it('notificación duplicada: se responde 200 «duplicate» (MP deja de reintentar) sin efecto repetido', async () => {
    mpClientMock.mockReturnValue({ request: vi.fn() })
    processMock.mockResolvedValueOnce({ outcome: 'processed' }).mockResolvedValueOnce({ outcome: 'duplicate' })
    expect(await (await POST(signed())).json()).toEqual({ ok: true, outcome: 'processed' })
    expect(await (await POST(signed())).json()).toEqual({ ok: true, outcome: 'duplicate' })
  })
  it('error al consultar la API de MP: 500 para que MP reintente (nunca se aprueba por haber recibido el aviso)', async () => {
    mpClientMock.mockReturnValue({ request: vi.fn() })
    processMock.mockRejectedValue(new Error('MP caído'))
    const res = await POST(signed()); expect(res.status).toBe(500); expect(await res.json()).toEqual({ error: 'retry' })
  })
  it('firma inválida: 401 y nada se registra ni procesa', async () => {
    const res = await POST(req('data.id=42&type=payment', { 'x-signature': BAD_SIG, 'x-request-id': RID }))
    expect(res.status).toBe(401); expect(h.state.logEvent).toHaveLength(0); expectNothingProcessed()
  })
})

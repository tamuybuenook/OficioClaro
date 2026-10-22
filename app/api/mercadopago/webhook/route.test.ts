import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const processMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/mercadopago/store', () => ({ createSupabaseMpStore: () => ({ logEvent: async () => 'e', finishEvent: async () => {} }) }))
vi.mock('@/lib/mercadopago/process-event', () => ({ processMpEvent: (...a: any[]) => processMock(...a) }))

import { POST } from './route'
import { describeSignatureRejection } from '@/lib/mercadopago/signature'

const req = (qs: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://app.test/api/mercadopago/webhook?${qs}`, { method: 'POST', headers, body: '{}' })
const sig = (id: string, rid: string) => `ts=1,v1=${createHmac('sha256', 'sec').update(`id:${id};request-id:${rid};ts:1;`).digest('hex')}`

beforeEach(() => {
  processMock.mockReset()
  Object.assign(process.env, { MP_ACCESS_TOKEN: 't', MP_WEBHOOK_SECRET: 'sec', APP_URL: 'https://app.test', MP_ENV: 'test' })
  delete process.env.VERCEL_ENV
})

describe('POST /api/mercadopago/webhook', () => {
  it('firma inválida o ausente: 401 y no procesa nada', async () => {
    expect((await POST(req('data.id=1&type=payment'))).status).toBe(401)
    expect((await POST(req('data.id=1&type=payment', { 'x-signature': 'ts=1,v1=' + 'a'.repeat(64), 'x-request-id': 'r' }))).status).toBe(401)
    expect(processMock).not.toHaveBeenCalled()
  })
  it('firma válida: procesa y responde 200', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' })
    const res = await POST(req('data.id=1&type=payment', { 'x-signature': sig('1', 'r'), 'x-request-id': 'r' }))
    expect(res.status).toBe(200)
    expect(processMock.mock.calls[0][1]).toEqual({ topic: 'payment', dataId: '1' })
  })
  it('error transitorio: 500 para que MP reintente', async () => {
    processMock.mockRejectedValue(new Error('db down'))
    expect((await POST(req('data.id=1&type=payment', { 'x-signature': sig('1', 'r'), 'x-request-id': 'r' }))).status).toBe(500)
  })
  it('sin configuración: 500 (nunca acepta sin validar)', async () => {
    delete process.env.MP_WEBHOOK_SECRET
    expect((await POST(req('data.id=1&type=payment'))).status).toBe(500)
  })
})

describe('diagnóstico seguro de firmas rechazadas', () => {
  const SECRET = 'ZZ-clave-unica-9'
  const logs = (spy: any) => spy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
  const run = async (qs: string, headers: Record<string, string> = {}) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await POST(req(qs, headers)); const out = logs(spy); spy.mockRestore()
    return { res, out }
  }
  it.each([
    ['falta_x_signature', 'data.id=1&type=payment', { 'x-request-id': 'r' }],
    ['falta_x_request_id', 'data.id=1&type=payment', { 'x-signature': 'ts=1,v1=' + 'a'.repeat(64) }],
    ['falta_data_id', 'type=payment', { 'x-signature': 'ts=1,v1=' + 'a'.repeat(64), 'x-request-id': 'r' }],
    ['formato_invalido', 'data.id=1&type=payment', { 'x-signature': 'ts=1,v1=corta', 'x-request-id': 'r' }],
    ['formato_invalido', 'data.id=1&type=payment', { 'x-signature': 'v1=' + 'a'.repeat(64), 'x-request-id': 'r' }],
    ['firma_no_coincide', 'data.id=1&type=payment', { 'x-signature': 'ts=1,v1=' + 'a'.repeat(64), 'x-request-id': 'r' }],
  ])('%s → 401 externo igual y se registra solo la categoría', async (cat, qs, headers) => {
    const { res, out } = await run(qs, headers as Record<string, string>)
    expect(res.status).toBe(401); expect(await res.json()).toEqual({ error: 'invalid_signature' })
    expect(out).toContain('[mp-webhook] firma rechazada'); expect(out).toContain(`"categoria":"${cat}"`)
    expect(processMock).not.toHaveBeenCalled()
  })
  it('firma_no_coincide: registra espacios del secreto (sí/no) y edad del ts; nunca secreto, firma, request-id ni data.id', async () => {
    process.env.MP_WEBHOOK_SECRET = SECRET
    const V1 = 'b'.repeat(64)
    const { out } = await run('data.id=987654321&type=payment', { 'x-signature': `ts=1,v1=${V1}`, 'x-request-id': 'req-secreto-id' })
    expect(out).toContain('"secreto_espacios_borde":false'); expect(out).toMatch(/"ts_edad_s":\d+/)
    for (const bad of [SECRET, V1, 'req-secreto-id', '987654321', 'x-signature']) expect(out).not.toContain(bad)
  })
  it('secreto con salto de línea o espacio al borde: lo informa como sí, sin mostrarlo (y la firma sigue rechazada)', async () => {
    process.env.MP_WEBHOOK_SECRET = 'sec\n'
    const { res, out } = await run('data.id=1&type=payment', { 'x-signature': sig('1', 'r'), 'x-request-id': 'r' })
    expect(res.status).toBe(401); expect(out).toContain('"secreto_espacios_borde":true'); expect(out).not.toContain('sec\n')
  })
  it('edad del timestamp: segundos y milisegundos; no calculable si ts no es numérico', () => {
    const now = () => 1_700_000_100_000
    const o = (ts: string) => describeSignatureRejection({ secret: 's', signatureHeader: `ts=${ts},v1=${'a'.repeat(64)}`, requestId: 'r', dataId: '1' }, now)
    expect(o('1700000000')).toMatchObject({ categoria: 'firma_no_coincide', ts_edad_s: 100 })
    expect(o('1700000000000')).toMatchObject({ ts_edad_s: 100 })
    expect(o('abc')).toMatchObject({ ts_edad_s: null })
  })
  it('aviso IPN de merchant_order (?id=…&topic=…, sin data.id ni firma): 401, no procesa nada y el registro lo identifica como «ipn»', async () => {
    const { res, out } = await run('id=45481702722&topic=merchant_order')
    expect(res.status).toBe(401); expect(await res.json()).toEqual({ error: 'invalid_signature' })
    expect(out).toContain('\"formato\":\"ipn\"'); expect(out).toContain('\"topic\":\"merchant_order\"')
    expect(out).not.toContain('45481702722') // el id de la orden tampoco se registra
    expect(processMock).not.toHaveBeenCalled()
  })
  it('un webhook normal con firma mala se registra como «webhook»; un topic raro no se copia al registro', async () => {
    const a = await run('data.id=1&type=payment', { 'x-signature': 'ts=1,v1=' + 'a'.repeat(64), 'x-request-id': 'r' })
    expect(a.out).toContain('\"formato\":\"webhook\"'); expect(a.out).toContain('\"topic\":\"payment\"')
    const b = await run('id=1&topic=' + encodeURIComponent('<script>x</script>'))
    expect(b.out).toContain('\"topic\":null'); expect(b.out).not.toContain('script')
  })
  it('una firma válida no registra rechazo y sigue procesando', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' })
    const { res, out } = await run('data.id=1&type=payment', { 'x-signature': sig('1', 'r'), 'x-request-id': 'r' })
    expect(res.status).toBe(200); expect(out).not.toContain('firma rechazada')
  })
})

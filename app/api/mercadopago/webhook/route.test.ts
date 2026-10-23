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
    const spyInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const res = await POST(req(qs, headers)); const out = logs(spy) + '\n' + logs(spyInfo); spy.mockRestore(); spyInfo.mockRestore()
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
    expect(out).toContain('[MP_WEBHOOK_TRACE]'); expect(out).toContain(`"categoria":"${cat}"`)
    expect(processMock).not.toHaveBeenCalled()
  })
  it('firma_no_coincide: registra espacios del secreto (sí/no) y edad del ts; nunca secreto, firma, request-id ni data.id', async () => {
    process.env.MP_WEBHOOK_SECRET = SECRET
    const V1 = 'b'.repeat(64)
    const { out } = await run('data.id=987654321&type=payment', { 'x-signature': `ts=1,v1=${V1}`, 'x-request-id': 'req-secreto-id' })
    expect(out).toContain('"secreto_espacios_borde":false'); expect(out).toMatch(/"ts_edad_s":\d+/)
    for (const bad of [SECRET, V1, 'req-secreto-id', '987654321', 'x-signature']) expect(out).not.toContain(bad)
  })
  it('secreto con salto de línea o espacio al borde: se normaliza, la firma válida se acepta y el registro solo informa «normalizado»', async () => {
    process.env.MP_WEBHOOK_SECRET = ' "sec"\n'
    processMock.mockResolvedValue({ outcome: 'processed' })
    const { res, out } = await run('data.id=1&type=payment', { 'x-signature': sig('1', 'r'), 'x-request-id': 'r' })
    expect(res.status).toBe(200); expect(out).toContain('"secreto_normalizado":true'); expect(out).not.toContain('sec"')
  })
  it('secreto con espacios INTERNOS: configuración inválida (500), nunca se «arregla» ni se acepta', async () => {
    process.env.MP_WEBHOOK_SECRET = 'se c'
    const { res, out } = await run('data.id=1&type=payment', { 'x-signature': sig('1', 'r'), 'x-request-id': 'r' })
    expect(res.status).toBe(500); expect(out).toContain('configuracion_incompleta'); expect(out).not.toContain('se c')
    expect(processMock).not.toHaveBeenCalled()
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

describe('data.id: query, cuerpo y ambigüedad', () => {
  const reqBody = (qs: string, body: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(`https://app.test/api/mercadopago/webhook?${qs}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const quiet = () => [vi.spyOn(console, 'error').mockImplementation(() => undefined), vi.spyOn(console, 'info').mockImplementation(() => undefined)]
  const H = (id: string) => ({ 'x-signature': sig(id, 'r'), 'x-request-id': 'r' })

  it('id en la query y el mismo en el cuerpo: procesa con ese id', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' }); quiet()
    const res = await POST(reqBody('data.id=7&type=payment', { type: 'payment', data: { id: '7' } }, H('7')))
    expect(res.status).toBe(200); expect(processMock.mock.calls[0][1]).toEqual({ topic: 'payment', dataId: '7' })
  })
  it('id solo en la query (cuerpo sin id): igual que antes', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' }); quiet()
    expect((await POST(reqBody('data.id=7&type=payment', {}, H('7')))).status).toBe(200)
  })
  it('id numérico en el cuerpo igual al de la query: se acepta', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' }); quiet()
    expect((await POST(reqBody('data.id=7&type=payment', { data: { id: 7 } }, H('7')))).status).toBe(200)
  })
  it('id solo en el cuerpo: NO se usa para firmar ni procesar (401) y el registro lo señala sin mostrarlo', async () => {
    const [err] = quiet()
    const res = await POST(reqBody('type=payment', { data: { id: '555123' } }, H('555123')))
    expect(res.status).toBe(401); expect(processMock).not.toHaveBeenCalled()
    const out = err.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(out).toContain('"categoria":"falta_data_id"'); expect(out).toContain('"id_solo_en_cuerpo":true'); expect(out).not.toContain('555123')
  })
  it('sin id en ningún lado: 401 y nada se procesa', async () => {
    quiet(); expect((await POST(reqBody('type=payment', {}, H('1')))).status).toBe(401); expect(processMock).not.toHaveBeenCalled()
  })
  it('query y cuerpo contradictorios con firma válida para la query: 400 y nada se procesa', async () => {
    const [err] = quiet()
    const res = await POST(reqBody('data.id=7&type=payment', { data: { id: '8' } }, H('7')))
    expect(res.status).toBe(400); expect(await res.json()).toEqual({ error: 'ambiguous_event_id' }); expect(processMock).not.toHaveBeenCalled()
    expect(err.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('query_y_cuerpo_distintos')
  })
  it('id del cuerpo con formato inválido (p. ej. inyección): 400, sin procesar ni copiar el texto al registro', async () => {
    const [err] = quiet()
    const res = await POST(reqBody('data.id=7&type=payment', { data: { id: '7;DROP TABLE x' } }, H('7')))
    expect(res.status).toBe(400); expect(processMock).not.toHaveBeenCalled()
    expect(err.mock.calls.map((c) => c.join(' ')).join('\n')).not.toContain('DROP')
  })
  it('cuerpo que no es JSON: se ignora y se procesa con el id de la query', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' }); quiet()
    expect((await POST(reqBody('data.id=7&type=payment', 'no-json', H('7')))).status).toBe(200)
  })
  it('topic desde el cuerpo cuando falta en la query', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' }); quiet()
    await POST(reqBody('data.id=7', { type: 'subscription_preapproval', data: { id: '7' } }, H('7')))
    expect(processMock.mock.calls[0][1]).toEqual({ topic: 'subscription_preapproval', dataId: '7' })
  })
})

describe('trazas [MP_WEBHOOK_TRACE]', () => {
  const ID = '987654321', RID = 'req-privado-xyz'
  const capture = async (qs: string, headers: Record<string, string>, body: unknown = { type: 'payment', data: { id: ID }, clave_cuerpo: 'valor-cuerpo-privado' }) => {
    const raw: string[] = []
    const e = vi.spyOn(console, 'error').mockImplementation((...c: unknown[]) => { raw.push(c.join(' ')) })
    const i = vi.spyOn(console, 'info').mockImplementation((...c: unknown[]) => { raw.push(c.join(' ')) })
    const res = await POST(new NextRequest(`https://app.test/api/mercadopago/webhook?${qs}`, { method: 'POST', headers, body: JSON.stringify(body) }))
    const lines = raw.filter((l) => l.startsWith('[MP_WEBHOOK_TRACE]')).map((l) => JSON.parse(l.slice('[MP_WEBHOOK_TRACE] '.length)))
    e.mockRestore(); i.mockRestore()
    return { res, lines }
  }
  it('camino feliz: entrada → firma → evento → persistencia → procesamiento → salida, con el mismo seguimiento y sin datos sensibles', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' })
    const { res, lines } = await capture(`data.id=${ID}&type=payment`, { 'x-signature': sig(ID, RID), 'x-request-id': RID })
    expect(res.status).toBe(200)
    expect(lines.map((l) => l.etapa)).toEqual(['entrada', 'firma', 'evento', 'persistencia', 'procesamiento', 'salida'])
    expect(new Set(lines.map((l) => l.seguimiento)).size).toBe(1); expect(lines[0].seguimiento).toMatch(/^[0-9a-f]{8}$/)
    expect(lines[0]).toMatchObject({ metodo: 'POST', topic: 'payment', presentes: { x_signature: true, x_request_id: true, data_id_query: true, data_id_cuerpo: true } })
    expect(lines[1].resultado).toBe('aceptada'); expect(lines[4].resultado).toBe('processed')
    expect(lines[5]).toMatchObject({ http: 200 }); expect(typeof lines[5].duracion_ms).toBe('number')
    const all = JSON.stringify(lines)
    for (const bad of [ID, RID, '"sec"', sig(ID, RID).slice(6), 'valor-cuerpo-privado', 'clave_cuerpo']) expect(all).not.toContain(bad)
  })
  it('firma rechazada: etapa firma con categoría y salida 401 (nunca llega a evento ni procesamiento)', async () => {
    const { res, lines } = await capture(`data.id=${ID}&type=payment`, { 'x-signature': 'ts=1,v1=' + 'a'.repeat(64), 'x-request-id': RID })
    expect(res.status).toBe(401)
    expect(lines.map((l) => l.etapa)).toEqual(['entrada', 'firma', 'salida'])
    expect(lines[1]).toMatchObject({ resultado: 'rechazada', categoria: 'firma_no_coincide', secreto_normalizado: false })
    expect(JSON.stringify(lines)).not.toContain('a'.repeat(64)); expect(lines[2].http).toBe(401)
  })
  it('error de procesamiento: sigue siendo 500 (no se oculta), sin el mensaje de la excepción', async () => {
    processMock.mockRejectedValue(new Error('detalle-sensible-de-db'))
    const { res, lines } = await capture(`data.id=${ID}&type=payment`, { 'x-signature': sig(ID, RID), 'x-request-id': RID })
    expect(res.status).toBe(500)
    expect(lines.find((l) => l.etapa === 'procesamiento')).toMatchObject({ resultado: 'error', error: 'Error' })
    expect(JSON.stringify(lines)).not.toContain('detalle-sensible'); expect(lines.at(-1)).toMatchObject({ etapa: 'salida', http: 500 })
  })
})

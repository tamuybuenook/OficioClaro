import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

// Diagnóstico: qué recibe el endpoint y con qué se valida la firma. Solo se observan trazas; la validación no cambia.
const processMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/mercadopago/store', () => ({ createSupabaseMpStore: () => ({ logEvent: async () => 'e', finishEvent: async () => {} }) }))
vi.mock('@/lib/mercadopago/process-event', () => ({ processMpEvent: (...a: any[]) => processMock(...a) }))

import { POST } from './route'

const SECRET = 'whsec-diagnostico', RID = 'req-id-privado-77', TS = '1761181234567'
const V1 = (id: string, rid = RID, ts = TS, secret = SECRET) => createHmac('sha256', secret).update(`id:${id};request-id:${rid};ts:${ts};`).digest('hex')
const H = (id: string, extra: Record<string, string> = {}) => ({ 'x-signature': `ts=${TS},v1=${V1(id)}`, 'x-request-id': RID, ...extra })

let raw: string[]
beforeEach(() => {
  raw = []; processMock.mockReset()
  Object.assign(process.env, { MP_ACCESS_TOKEN: 'APP_USR-tok-privado', MP_WEBHOOK_SECRET: SECRET, APP_URL: 'https://app.test', MP_ENV: 'test' })
  delete process.env.VERCEL_ENV
  vi.spyOn(console, 'error').mockImplementation((...c: unknown[]) => { raw.push(c.join(' ')) })
  vi.spyOn(console, 'info').mockImplementation((...c: unknown[]) => { raw.push(c.join(' ')) })
})
afterEach(() => vi.restoreAllMocks())

const send = async (qs: string, headers: Record<string, string>, body: unknown = {}) => {
  const res = await POST(new NextRequest(`https://app.test/api/mercadopago/webhook?${qs}`, { method: 'POST', headers, body: JSON.stringify(body) }))
  const t = raw.filter((l) => l.startsWith('[MP_WEBHOOK_TRACE]')).map((l) => JSON.parse(l.slice(19)))
  const by = (etapa: string) => t.find((l) => l.etapa === etapa)
  return { res, t, entrada: by('entrada'), firma: by('firma'), salida: by('salida'), all: JSON.stringify(t) }
}
const noLeak = (all: string, ...vals: string[]) => { for (const v of [RID, SECRET, 'APP_USR', V1('x').slice(0, 20), `ts=${TS}`, ...vals]) expect(all, v).not.toContain(v) }

describe('merchant_order en formato IPN (sin data.id)', () => {
  it('firma calculada CON el id de la orden (no es data.id): el manifest real es sin id, así que no coincide → 401 firma_no_coincide; el id de la orden no se usa ni se registra', async () => {
    const { res, entrada, firma, all, t } = await send('id=45481702722&topic=merchant_order', { 'x-signature': `ts=${TS},v1=${V1('45481702722')}`, 'x-request-id': RID })
    expect(res.status).toBe(401); expect(processMock).not.toHaveBeenCalled()
    expect(entrada).toMatchObject({ metodo: 'POST', formato: 'ipn', topic: 'merchant_order', topic_query: 'merchant_order', type_query: null,
      presentes: { x_signature: true, x_request_id: true, data_id_query: false, data_id_cuerpo: false, id_query_ipn: true },
      ids: { ambos_presentes: false, coinciden: null, fuente_usada_para_firmar: 'ninguna' } })
    expect(firma).toMatchObject({ resultado: 'rechazada', categoria: 'firma_no_coincide', motivo: 'hmac_distinto_manifest_sin_id',
      manifest: { plantilla: 'request-id:<x-request-id>;ts:<ts de x-signature>;', id: { presente: false, origen: 'query', forma: null }, request_id: { presente: true }, ts: { presente: true } } })
    expect(t.map((l) => l.etapa)).toEqual(['entrada', 'firma', 'salida'])
    noLeak(all, '45481702722')
  })
  it('sin x-signature (IPN clásico): categoría falta_x_signature, nunca se acepta', async () => {
    const { res, firma } = await send('id=1&topic=merchant_order', {})
    expect(res.status).toBe(401); expect(firma).toMatchObject({ categoria: 'falta_x_signature', motivo: 'falta_x_signature' })
  })
})

describe('payment con ID en query', () => {
  it('firma válida: aceptada, el manifest declara origen de cada campo y el id se firma desde la query', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' })
    const { res, entrada, firma, all } = await send('data.id=123456789&type=payment', H('123456789'), { type: 'payment', action: 'payment.created', live_mode: true, data: { id: '123456789' } })
    expect(res.status).toBe(200)
    expect(entrada).toMatchObject({ topic: 'payment', type_query: 'payment', type_cuerpo: 'payment', action_cuerpo: 'payment.created', live_mode_cuerpo: true, cuerpo_json: true,
      ids: { ambos_presentes: true, coinciden: true, fuente_usada_para_firmar: 'query', fuente_usada_para_procesar: 'query', query_forma: 'numerico' },
      x_signature_estructura: { presente: true, partes: 2, partes_desconocidas: 0, ts: 'ok', ts_forma: 'milisegundos', ts_digitos: 13, v1: 'ok_hex64', v1_largo: 64 }, x_request_id_largo: RID.length })
    expect(firma).toMatchObject({ resultado: 'aceptada', mp_env: 'test', vercel_env: null, secreto_normalizado: false,
      manifest: { plantilla: 'id:<data.id de la query>;request-id:<x-request-id>;ts:<ts de x-signature>;',
        id: { presente: true, origen: 'query', forma: 'numerico', largo: 9, minusculas_cambia_valor: false },
        request_id: { presente: true, origen: 'cabecera x-request-id', largo: RID.length }, ts: { presente: true, origen: 'cabecera x-signature (ts)' } } })
    noLeak(all, '123456789')
  })
  it('id alfanumérico con mayúsculas: el manifest lo marca (se firma en minúsculas) y la firma sobre minúsculas se acepta', async () => {
    processMock.mockResolvedValue({ outcome: 'processed' })
    const { res, firma } = await send('data.id=AbC123&type=payment', H('abc123'))
    expect(res.status).toBe(200); expect(firma.manifest.id).toMatchObject({ forma: 'alfanumerico', minusculas_cambia_valor: true })
  })
})

describe('ID solo en el cuerpo', () => {
  it('no se usa para firmar aunque la firma sea válida para ese id: 401, motivo id_solo_en_cuerpo, fuente «ninguna»', async () => {
    const { res, entrada, firma, all } = await send('type=payment', H('555123'), { type: 'payment', data: { id: '555123' } })
    expect(res.status).toBe(401); expect(processMock).not.toHaveBeenCalled()
    expect(entrada).toMatchObject({ presentes: { data_id_query: false, data_id_cuerpo: true }, ids: { ambos_presentes: false, fuente_usada_para_firmar: 'ninguna', cuerpo_forma: 'numerico' } })
    expect(firma).toMatchObject({ categoria: 'falta_data_id', motivo: 'id_solo_en_cuerpo' }); noLeak(all, '555123')
  })
})

describe('IDs contradictorios', () => {
  it('firma válida para la query pero el cuerpo nombra otro recurso: 400, coinciden=false, nada se procesa', async () => {
    const { res, entrada, t, all } = await send('data.id=111&type=payment', H('111'), { data: { id: '222' } })
    expect(res.status).toBe(400); expect(processMock).not.toHaveBeenCalled()
    expect(entrada.ids).toMatchObject({ ambos_presentes: true, coinciden: false, fuente_usada_para_firmar: 'query' })
    expect(t.find((l) => l.etapa === 'evento')).toMatchObject({ resultado: 'id_contradictorio', motivo: 'query_y_cuerpo_distintos' }); noLeak(all, '111', '222')
  })
  it('firma calculada con el id del cuerpo y query distinta: rechazada por firma (hmac_distinto), con la pista de ids contradictorios', async () => {
    const { res, firma } = await send('data.id=111&type=payment', H('222'), { data: { id: '222' } })
    expect(res.status).toBe(401)
    expect(firma).toMatchObject({ categoria: 'firma_no_coincide', motivo: 'hmac_distinto', pistas: { ids_contradictorios: true } })
  })
})

describe('firma no coincidente', () => {
  it('secreto distinto: 401 hmac_distinto con estructura, manifest, entorno y edad del ts; sin ningún valor sensible', async () => {
    const bad = { 'x-signature': `ts=${TS},v1=${V1('777', RID, TS, 'otro-secreto')}`, 'x-request-id': RID }
    const { res, firma, t, all } = await send('data.id=777&type=payment', bad, { live_mode: false, data: { id: '777' } })
    expect(res.status).toBe(401); expect(processMock).not.toHaveBeenCalled()
    expect(t.map((l) => l.etapa)).toEqual(['entrada', 'firma', 'salida'])
    expect(firma).toMatchObject({ resultado: 'rechazada', categoria: 'firma_no_coincide', motivo: 'hmac_distinto', mp_env: 'test', secreto_normalizado: false,
      pistas: { ids_contradictorios: false, live_mode_cuerpo: false }, manifest: { id: { presente: true }, request_id: { presente: true }, ts: { presente: true } } })
    expect(typeof firma.ts_edad_s).toBe('number'); noLeak(all, '777', V1('777', RID, TS, 'otro-secreto'))
  })
  it('VERCEL_ENV y MP_ENV quedan registrados para cruzar con el modo del secreto', async () => {
    process.env.VERCEL_ENV = 'production'; process.env.MP_ENV = 'production'
    const { firma } = await send('data.id=1&type=payment', { 'x-signature': `ts=${TS},v1=${'a'.repeat(64)}`, 'x-request-id': RID })
    expect(firma).toMatchObject({ mp_env: 'production', vercel_env: 'production' }); delete process.env.VERCEL_ENV
  })
  it('estructura de x-signature defectuosa: motivo concreto, sin copiar valores', async () => {
    const cases: [string, string][] = [['ts=1,v1=corta', 'ts_ok_v1_no_hex64'], [`v1=${'a'.repeat(64)}`, 'ts_falta_v1_ok_hex64'], ['ts=,v1=', 'ts_vacio_v1_vacio'], ['basura', 'ts_falta_v1_falta']]
    for (const [h, motivo] of cases) {
      raw = []
      const { res, firma, entrada, all } = await send('data.id=1&type=payment', { 'x-signature': h, 'x-request-id': RID })
      expect(res.status, h).toBe(401); expect(firma, h).toMatchObject({ categoria: 'formato_invalido', motivo }); expect(entrada.x_signature_estructura.presente).toBe(true)
      expect(all).not.toContain('corta'); expect(all).not.toContain(h)
    }
  })
  it('sin x-request-id: categoría falta_x_request_id', async () => {
    const { res, firma, entrada } = await send('data.id=1&type=payment', { 'x-signature': `ts=${TS},v1=${V1('1')}` })
    expect(res.status).toBe(401); expect(firma).toMatchObject({ categoria: 'falta_x_request_id', manifest: { request_id: { presente: false, largo: null } } })
    expect(entrada.presentes.x_request_id).toBe(false)
  })
})

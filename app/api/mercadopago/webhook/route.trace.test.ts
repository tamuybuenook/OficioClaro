import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

// Integración: ruta real + processMpEvent real + cliente de MP real con fetch simulado (nunca se llama a Mercado Pago).
const fakeStore = { logEvent: vi.fn(async () => 'e1' as string | null), finishEvent: vi.fn(async () => {}) }
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/mercadopago/store', () => ({ createSupabaseMpStore: () => fakeStore }))

import { POST } from './route'

const SECRET = 'whsec-prueba', ID = '123456789', RID = 'rid-privado'
const sig = `ts=1,v1=${createHmac('sha256', SECRET).update(`id:${ID};request-id:${RID};ts:1;`).digest('hex')}`
const call = () => POST(new NextRequest(`https://app.test/api/mercadopago/webhook?data.id=${ID}&type=payment`, { method: 'POST', headers: { 'x-signature': sig, 'x-request-id': RID }, body: '{}' }))

let raw: string[]
beforeEach(() => {
  raw = []
  Object.assign(process.env, { MP_ACCESS_TOKEN: 'APP_USR-token-privado', MP_WEBHOOK_SECRET: SECRET, APP_URL: 'https://app.test', MP_ENV: 'test' })
  delete process.env.VERCEL_ENV
  fakeStore.logEvent.mockClear(); fakeStore.finishEvent.mockClear(); fakeStore.logEvent.mockResolvedValue('e1')
  vi.spyOn(console, 'error').mockImplementation((...c: unknown[]) => { raw.push(c.join(' ')) })
  vi.spyOn(console, 'info').mockImplementation((...c: unknown[]) => { raw.push(c.join(' ')) })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const traces = () => raw.filter((l) => l.startsWith('[MP_WEBHOOK_TRACE]')).map((l) => JSON.parse(l.slice(19)))

describe('trazas con consulta real a MP (fetch simulado)', () => {
  it('MP responde 404 al pago: consulta_mp registra http 404, resultado de negocio ignored y respuesta 200', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 404 })); vi.stubGlobal('fetch', f)
    const res = await call()
    const t = traces()
    expect(res.status).toBe(200)
    expect(t.filter((l) => l.etapa === 'consulta_mp')).toEqual([
      expect.objectContaining({ fase: 'inicio', metodo: 'GET', recurso: '/v1/payments/:id' }),
      expect.objectContaining({ fase: 'resultado', recurso: '/v1/payments/:id', http: 404, error: 'http' }),
    ])
    expect(t.find((l) => l.etapa === 'procesamiento')).toMatchObject({ resultado: 'ignored' })
    const all = JSON.stringify(t)
    for (const bad of [ID, RID, 'token-privado', 'APP_USR', sig.slice(6)]) expect(all).not.toContain(bad)
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: 'Bearer APP_USR-token-privado' }) // sigue consultando con el token privado
  })
  it('MP responde 500: NO se oculta (500 para que MP reintente) y la traza lleva el código HTTP de MP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"boom"}', { status: 500 })))
    const res = await call()
    const t = traces()
    expect(res.status).toBe(500)
    expect(t.find((l) => l.etapa === 'consulta_mp' && l.fase === 'resultado')).toMatchObject({ http: 500 })
    expect(t.find((l) => l.etapa === 'procesamiento')).toMatchObject({ resultado: 'error', error: 'mp_api' })
    expect(t.at(-1)).toMatchObject({ etapa: 'salida', http: 500 })
    expect(fakeStore.finishEvent).toHaveBeenCalledWith('e1', 'error', expect.any(String))
  })
  it('fallo de red/timeout: http 0 → red_o_timeout, también 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket') }))
    const res = await call()
    expect(res.status).toBe(500)
    expect(traces().find((l) => l.etapa === 'consulta_mp' && l.fase === 'resultado')).toMatchObject({ http: 0, error: 'red_o_timeout' })
  })
  it('no se pudo guardar el evento (logEvent devuelve null): se registra, y el procesamiento sigue con su resultado real', async () => {
    fakeStore.logEvent.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    const res = await call()
    expect(res.status).toBe(200)
    expect(traces().find((l) => l.etapa === 'persistencia')).toMatchObject({ operacion: 'logEvent', resultado: 'no_registrado' })
    expect(fakeStore.finishEvent).toHaveBeenCalledWith(null, 'ignored', expect.anything())
  })
})

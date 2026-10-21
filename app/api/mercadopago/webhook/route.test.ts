import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const processMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/mercadopago/store', () => ({ createSupabaseMpStore: () => ({ logEvent: async () => 'e', finishEvent: async () => {} }) }))
vi.mock('@/lib/mercadopago/process-event', () => ({ processMpEvent: (...a: any[]) => processMock(...a) }))

import { POST } from './route'

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

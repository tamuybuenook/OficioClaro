import { describe, it, expect, vi, beforeEach } from 'vitest'

const inserts: any[] = []
const reconcileIntents = vi.fn()
const recoverPreapprovals = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => ({ insert: async (row: any) => { inserts.push({ t, row }); return { error: null } } }) }) }))
vi.mock('@/lib/mercadopago/reconcile', () => ({ reconcileIntents: (...a: any[]) => reconcileIntents(...a), recoverPreapprovals: (...a: any[]) => recoverPreapprovals(...a) }))
vi.mock('@/lib/mercadopago/client', () => ({ createMpClient: () => ({}) }))
vi.mock('@/lib/mercadopago/store', () => ({ createSupabaseMpStore: () => ({}) }))

import { GET } from './route'

const req = (auth?: string) => new Request('https://x.test/api/mercadopago/reconcile', { headers: auth ? { authorization: auth } : {} }) as any
const ENV = { MP_ACCESS_TOKEN: 't', MP_WEBHOOK_SECRET: 's', MP_ENV: 'test', APP_URL: 'https://x.test', CRON_SECRET: 'cron-123' }

beforeEach(() => { inserts.length = 0; reconcileIntents.mockReset(); recoverPreapprovals.mockReset(); for (const k of Object.keys(ENV)) delete (process.env as any)[k]; delete (process.env as any).VERCEL_ENV })

describe('GET /api/mercadopago/reconcile', () => {
  it('sin CRON_SECRET configurado: 404 y no ejecuta nada', async () => {
    expect((await GET(req('Bearer x'))).status).toBe(404); expect(reconcileIntents).not.toHaveBeenCalled(); expect(inserts).toHaveLength(0)
  })
  it('sin cabecera o con secreto incorrecto: 401, no ejecuta ni registra', async () => {
    Object.assign(process.env, ENV)
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer otro-secreto'))).status).toBe(401)
    expect((await GET(req('Bearer cron-12'))).status).toBe(401)
    expect(reconcileIntents).not.toHaveBeenCalled(); expect(inserts).toHaveLength(0)
  })
  it('ejecución correcta: responde y deja registro mp_reconcile_run sin secretos', async () => {
    Object.assign(process.env, ENV)
    reconcileIntents.mockResolvedValue({ checked: 2, processed: 1, errors: 0 }); recoverPreapprovals.mockResolvedValue({ checked: 0 })
    const res = await GET(req('Bearer cron-123'))
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ payments: { checked: 2, processed: 1, errors: 0 }, preapprovals: { checked: 0 } })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ t: 'audit_logs', row: { action: 'mp_reconcile_run', entity: 'mp_reconcile', entity_id: null, actor_id: null } })
    expect(JSON.stringify(inserts[0])).not.toContain('cron-123')
  })
  it('falla interna: 500 y registro mp_reconcile_failed con solo el tipo de error', async () => {
    Object.assign(process.env, ENV)
    reconcileIntents.mockRejectedValue(new TypeError('token=APP_USR-secreto en el mensaje'))
    const res = await GET(req('Bearer cron-123'))
    expect(res.status).toBe(500)
    expect(inserts[0].row).toMatchObject({ action: 'mp_reconcile_failed', new_value: { error: 'TypeError' } })
    expect(JSON.stringify(inserts)).not.toContain('APP_USR')
  })
})

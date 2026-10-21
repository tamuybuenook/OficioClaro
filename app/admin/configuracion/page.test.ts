import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

let logs: any[] = []
vi.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: async () => ({ user: { id: 'a' }, supabase: { from: () => { const q: any = new Proxy({}, { get: (_t, n: string) => n === 'then' ? (r: any) => r({ data: logs, error: null }) : () => q }); return q } } }),
}))

const SECRET = 'APP_USR-token-que-no-debe-aparecer'
const saved = { ...process.env }
beforeEach(() => { logs = []; Object.assign(process.env, { MP_ACCESS_TOKEN: SECRET, MP_WEBHOOK_SECRET: 'whsec-no-mostrar', SUPABASE_SERVICE_ROLE_KEY: 'sb-no-mostrar', CRON_SECRET: 'cron-no-mostrar', MP_ENV: 'test', APP_URL: 'https://preview.oficioclaro.com', VERCEL_ENV: 'preview' }) })
afterEach(() => { process.env = { ...saved } })

describe('/admin/configuracion', () => {
  it('muestra entorno, variables, webhook y estado sin exponer secretos', async () => {
    const { default: Page } = await import('./page')
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain('Mercado Pago'); expect(html).toContain('Prueba'); expect(html).toContain('Coherente')
    expect(html).toContain('https://preview.oficioclaro.com/api/mercadopago/webhook')
    expect(html).toContain('MP_ACCESS_TOKEN'); expect(html).toContain('Presente')
    expect(html).toContain('Sin ejecuciones registradas'); expect(html).toContain('no prueba')
    for (const s of [SECRET, 'whsec-no-mostrar', 'sb-no-mostrar', 'cron-no-mostrar']) expect(html).not.toContain(s)
  })
  it('detecta producción con MP_ENV=test y variables ausentes', async () => {
    process.env.VERCEL_ENV = 'production'; delete process.env.MP_WEBHOOK_SECRET
    const { default: Page } = await import('./page')
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain('Incoherente'); expect(html).toContain('Ausente'); expect(html).toContain('Incompleta o incoherente')
  })
  it('con una ejecución registrada la muestra con su resultado', async () => {
    logs = [{ action: 'mp_reconcile_run', created_at: new Date().toISOString(), new_value: { payments: { checked: 3, processed: 1, errors: 0 } } }]
    const { default: Page } = await import('./page')
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain('Última ejecución correcta'); expect(html).toContain('3 / 1 / 0')
  })
})

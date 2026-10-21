import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { computeMpSettings, evaluateReconcile, RECONCILE_CRON_SCHEDULE, RECONCILE_PATH, WEBHOOK_PATH } from './mp-settings'

const SECRETS = { MP_ACCESS_TOKEN: 'APP_USR-super-secreto-123', MP_WEBHOOK_SECRET: 'whsec-ultra-secreta', SUPABASE_SERVICE_ROLE_KEY: 'sb-service-xyz', CRON_SECRET: 'cron-secreto-abc' }
const full = (o: Record<string, string> = {}) => ({ ...SECRETS, MP_ENV: 'test', APP_URL: 'https://preview.oficioclaro.com', VERCEL_ENV: 'preview', ...o }) as unknown as NodeJS.ProcessEnv

describe('computeMpSettings', () => {
  it('NUNCA expone valores de secretos', () => {
    const json = JSON.stringify(computeMpSettings(full()))
    for (const v of Object.values(SECRETS)) expect(json).not.toContain(v)
  })
  it('preview con MP_ENV=test: completo y coherente', () => {
    const s = computeMpSettings(full())
    expect(s).toMatchObject({ env: 'test', ready: true, missingRequired: [], cronSecretPresent: true })
    expect(s.coherence.state).toBe('ok')
    expect(s.webhookUrl).toBe(`https://preview.oficioclaro.com${WEBHOOK_PATH}`)
    expect(s.reconcileUrl).toBe(`https://preview.oficioclaro.com${RECONCILE_PATH}`)
  })
  it('production con MP_ENV=test: incoherente y no listo', () => {
    const s = computeMpSettings(full({ VERCEL_ENV: 'production' }))
    expect(s.coherence.state).toBe('mismatch'); expect(s.ready).toBe(false)
  })
  it('preview con MP_ENV=production: incoherente (riesgo de cobros reales)', () => {
    const s = computeMpSettings(full({ MP_ENV: 'production' }))
    expect(s.coherence.state).toBe('mismatch'); expect(s.coherence.message).toMatch(/cobros reales/)
  })
  it('sin VERCEL_ENV: coherencia desconocida, no inventa un resultado', () => {
    const e = full(); delete (e as any).VERCEL_ENV
    expect(computeMpSettings(e).coherence.state).toBe('unknown')
  })
  it('lista las variables ausentes sin revelar nada más; CRON_SECRET es opcional', () => {
    const e = full(); delete (e as any).MP_ACCESS_TOKEN; delete (e as any).CRON_SECRET
    const s = computeMpSettings(e)
    expect(s.missingRequired).toEqual(['MP_ACCESS_TOKEN']); expect(s.cronSecretPresent).toBe(false); expect(s.ready).toBe(false)
    expect(s.vars.find((v) => v.name === 'CRON_SECRET')).toMatchObject({ required: false, present: false })
  })
  it('valores en blanco cuentan como ausentes; MP_ENV inválido se informa', () => {
    expect(computeMpSettings(full({ MP_ACCESS_TOKEN: '   ' })).missingRequired).toContain('MP_ACCESS_TOKEN')
    expect(computeMpSettings(full({ MP_ENV: 'prod' })).env).toBe('invalid')
  })
  it('APP_URL: http, barra final, ruta, localhost en producción', () => {
    expect(computeMpSettings(full({ APP_URL: 'http://x.com' })).appUrl.issues.join(' ')).toMatch(/https/)
    expect(computeMpSettings(full({ APP_URL: 'https://x.com/' })).appUrl.issues.join(' ')).toMatch(/barra/)
    expect(computeMpSettings(full({ APP_URL: 'https://x.com/app' })).appUrl.issues.join(' ')).toMatch(/origen/)
    expect(computeMpSettings(full({ MP_ENV: 'production', VERCEL_ENV: 'production', APP_URL: 'https://localhost' })).appUrl.issues.join(' ')).toMatch(/localhost/)
    const s = computeMpSettings(full({ APP_URL: 'no es url' })); expect(s.webhookUrl).toBeNull()
    for (const v of ['https://oficioclaro.vercel.app\nCopiar', 'https://oficioclaro.vercel.app\tCopiar', 'https://oficioclaro.vercel.app Copiar']) {
      const d = computeMpSettings(full({ APP_URL: v }))
      expect(d.webhookUrl).toBeNull(); expect(d.reconcileUrl).toBeNull(); expect(d.appUrl.issues.join(' ')).toMatch(/Copiar|saltos de línea/)
    }
  })
})

describe('evaluateReconcile', () => {
  const NOW = new Date('2026-10-18T12:00:00Z')
  const log = (action: string, hoursAgo: number) => ({ action, created_at: new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString(), new_value: {} })
  it('sin CRON_SECRET: deshabilitada', () => expect(evaluateReconcile(null, { cronSecretPresent: false, now: NOW }).state).toBe('disabled'))
  it('sin registros: "never" y no afirma que esté activo', () => {
    const r = evaluateReconcile(null, { cronSecretPresent: true, now: NOW }); expect(r.state).toBe('never'); expect(r.message).toMatch(/no prueba/)
  })
  it('éxito reciente: ok; viejo: stale; fallo: failed', () => {
    expect(evaluateReconcile(log('mp_reconcile_run', 5), { cronSecretPresent: true, now: NOW }).state).toBe('ok')
    expect(evaluateReconcile(log('mp_reconcile_run', 40), { cronSecretPresent: true, now: NOW }).state).toBe('stale')
    expect(evaluateReconcile(log('mp_reconcile_failed', 1), { cronSecretPresent: true, now: NOW }).state).toBe('failed')
  })
})

describe('vercel.json', () => {
  it('declara el cron de conciliación con la misma ruta y programación que usa el panel', () => {
    const v = JSON.parse(readFileSync('vercel.json', 'utf8'))
    expect(v.crons).toEqual([{ path: RECONCILE_PATH, schedule: RECONCILE_CRON_SCHEDULE }])
  })
  it('la programación es diaria (única válida en Hobby: expresiones más frecuentes hacen fallar el deploy)', () => {
    const [min, hour, dom, mon, dow] = RECONCILE_CRON_SCHEDULE.split(' ')
    expect(/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*').toBe(true)
  })
})

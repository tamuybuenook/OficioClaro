import { describe, it, expect } from 'vitest'
import { getMpConfig, MpConfigError } from './config'

const TOKEN = 'TOKEN-SECRETO-no-mostrar-123'
const WHSEC = 'WHSEC-SECRETO-no-mostrar-456'
const base = { MP_ACCESS_TOKEN: TOKEN, MP_WEBHOOK_SECRET: WHSEC, APP_URL: 'https://oficioclaro.vercel.app', MP_ENV: 'test' } as unknown as NodeJS.ProcessEnv
const env = (o: Record<string, string | undefined>) => ({ ...base, ...o }) as unknown as NodeJS.ProcessEnv
const PROD_TEST_OK = env({ VERCEL_ENV: 'production', MP_ENV: 'test', MP_ALLOW_TEST_IN_PRODUCTION: 'true' })

describe('Production + MP_ENV=test (prueba autorizada)', () => {
  it('1. con MP_ALLOW_TEST_IN_PRODUCTION=true: permitido y queda en modo prueba', () => {
    expect(getMpConfig(PROD_TEST_OK)).toMatchObject({ env: 'test', appUrl: 'https://oficioclaro.vercel.app' })
  })
  it('2. sin la variable de autorización: rechazado', () => {
    expect(() => getMpConfig(env({ VERCEL_ENV: 'production', MP_ENV: 'test' }))).toThrow(MpConfigError)
    expect(() => getMpConfig(env({ VERCEL_ENV: 'production', MP_ENV: 'test' }))).toThrow(/Producción requiere MP_ENV=production/)
  })
  it('3. con autorización false: rechazado', () => {
    expect(() => getMpConfig(env({ VERCEL_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: 'false' }))).toThrow(/Producción requiere/)
  })
  it('la autorización es EXACTA: solo el texto «true» (ni mayúsculas, ni espacios, ni otros valores)', () => {
    for (const v of ['TRUE', 'True', ' true', 'true ', 'true\n', '1', 'yes', 'si', 'on', 'verdadero', '', 'truee', 'tru'])
      expect(() => getMpConfig(env({ VERCEL_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: v })), JSON.stringify(v)).toThrow(/Producción requiere/)
  })
  it('la autorización no habilita nada más: exige las variables obligatorias y https', () => {
    for (const k of ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'APP_URL']) {
      expect(() => getMpConfig({ ...PROD_TEST_OK, [k]: undefined } as unknown as NodeJS.ProcessEnv), `falta ${k}`).toThrow(/no está configurado/)
      expect(() => getMpConfig({ ...PROD_TEST_OK, [k]: '' } as unknown as NodeJS.ProcessEnv), `${k} vacía`).toThrow(/no está configurado/)
    }
    expect(() => getMpConfig({ ...PROD_TEST_OK, APP_URL: 'http://oficioclaro.vercel.app' })).toThrow(/https/)
  })
  it('la autorización no reemplaza a MP_ENV: sigue exigiendo un valor válido', () => {
    for (const v of [undefined, '', 'otro', 'TEST']) expect(() => getMpConfig({ ...PROD_TEST_OK, MP_ENV: v } as unknown as NodeJS.ProcessEnv), String(v)).toThrow(/MP_ENV debe ser/)
  })
})

describe('comportamiento existente conservado', () => {
  it('4. Production + MP_ENV=production: igual que antes (con o sin la variable de autorización)', () => {
    const p = env({ VERCEL_ENV: 'production', MP_ENV: 'production' })
    expect(getMpConfig(p).env).toBe('production')
    expect(getMpConfig({ ...p, MP_ALLOW_TEST_IN_PRODUCTION: 'true' }).env).toBe('production')
    expect(getMpConfig({ ...p, MP_ALLOW_TEST_IN_PRODUCTION: 'false' }).env).toBe('production')
    expect(() => getMpConfig({ ...p, APP_URL: 'http://x.com' })).toThrow(/https/)
  })
  it('5. Preview/desarrollo con MP_ENV=test: igual que antes', () => {
    for (const v of ['preview', 'development']) expect(getMpConfig(env({ VERCEL_ENV: v, MP_ENV: 'test' })).env).toBe('test')
    expect(getMpConfig(env({})).env).toBe('test') // fuera de Vercel
  })
  it('5b. Preview/desarrollo con MP_ENV=production: sigue rechazado, aunque esté la autorización', () => {
    for (const v of ['preview', 'development'])
      for (const a of [undefined, 'true'])
        expect(() => getMpConfig(env({ VERCEL_ENV: v, MP_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: a }))).toThrow(/preview\/desarrollo deben usar MP_ENV=test/)
  })
  it('5c. la autorización solo afecta a Production: en Preview no cambia nada', () => {
    expect(getMpConfig(env({ VERCEL_ENV: 'preview', MP_ALLOW_TEST_IN_PRODUCTION: 'true' })).env).toBe('test')
    expect(getMpConfig(env({ MP_ALLOW_TEST_IN_PRODUCTION: 'true' })).env).toBe('test')
  })
  it('6. variables obligatorias ausentes o vacías: rechazado en todos los entornos', () => {
    for (const vercel of [undefined, 'preview', 'development', 'production'])
      for (const k of ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'APP_URL']) {
        const e = { ...env({ VERCEL_ENV: vercel, MP_ENV: vercel === 'production' ? 'production' : 'test' }), [k]: undefined } as unknown as NodeJS.ProcessEnv
        expect(() => getMpConfig(e), `${vercel} sin ${k}`).toThrow(MpConfigError)
      }
  })
})

describe('los mensajes de error no revelan secretos', () => {
  it('ningún rechazo contiene el token, la clave del webhook ni el texto de la variable de autorización', () => {
    const casos = [
      env({ VERCEL_ENV: 'production' }), env({ VERCEL_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: 'TRUE' }),
      env({ VERCEL_ENV: 'preview', MP_ENV: 'production' }), env({ MP_ENV: 'raro' }), { ...PROD_TEST_OK, APP_URL: 'http://x' },
      { ...PROD_TEST_OK, MP_ACCESS_TOKEN: undefined }, env({ MP_ENV: 'production', APP_URL: 'http://x.com' }),
    ]
    for (const e of casos) {
      let msg = ''
      try { getMpConfig(e as unknown as NodeJS.ProcessEnv) } catch (x) { msg = (x as Error).message }
      expect(msg.length).toBeGreaterThan(0)
      expect(msg).not.toContain(TOKEN); expect(msg).not.toContain(WHSEC)
    }
  })
})

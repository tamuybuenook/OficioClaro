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

describe('APP_URL: normalización al origen', () => {
  const ORIGIN = 'https://oficioclaro.vercel.app'
  it.each([
    ['limpia', ORIGIN],
    ['barra final', `${ORIGIN}/`],
    ['varias barras finales', `${ORIGIN}///`],
    ['espacio final', `${ORIGIN} `],
    ['espacios alrededor', `  ${ORIGIN}  `],
    ['salto de línea final', `${ORIGIN}\n`],
    ['CRLF final', `${ORIGIN}\r\n`],
    ['comillas dobles', `"${ORIGIN}"`],
    ['comillas simples', `'${ORIGIN}'`],
    ['comillas con espacios dentro', `" ${ORIGIN} "`],
    ['barra y espacio', `${ORIGIN}/ `],
    ['ruta adicional', `${ORIGIN}/app/`],
    ['query y hash', `${ORIGIN}/?a=1#x`],
  ])('%s → origen limpio', (_n, v) => {
    expect(getMpConfig(env({ APP_URL: v })).appUrl).toBe(ORIGIN)
    expect(getMpConfig(env({ APP_URL: v, VERCEL_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: 'true' })).appUrl).toBe(ORIGIN)
  })
  it.each([['sin protocolo', 'oficioclaro.vercel.app'], ['espacio en medio', 'https://oficio claro.vercel.app'], ['solo comillas con texto roto', '"https://"'], ['protocolo no http', 'ftp://oficioclaro.vercel.app'], ['javascript', 'javascript:alert(1)']])(
    'valor inválido (%s) → MpConfigError', (_n, v) => {
      expect(() => getMpConfig(env({ APP_URL: v }))).toThrow(MpConfigError)
    })
  it('vacío o solo espacios/comillas: sigue siendo "faltan variables"', () => {
    for (const v of ['', '   ', '""', undefined]) expect(() => getMpConfig(env({ APP_URL: v as any }))).toThrow(/faltan variables/)
  })
  it('http sigue rechazado en producción (MP_ENV=production o deployment Production), aunque venga sucio', () => {
    expect(() => getMpConfig(env({ APP_URL: ' "http://oficioclaro.vercel.app/" ', MP_ENV: 'production', VERCEL_ENV: 'production' }))).toThrow(/https/)
    expect(() => getMpConfig(env({ APP_URL: 'http://oficioclaro.vercel.app', VERCEL_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: 'true' }))).toThrow(/https/)
  })
  it('en preview/desarrollo http sigue permitido con MP_ENV=test', () => {
    expect(getMpConfig(env({ APP_URL: 'http://localhost:3000/', VERCEL_ENV: 'preview' })).appUrl).toBe('http://localhost:3000')
  })
  it('no altera las reglas de MP_ENV ni de MP_ALLOW_TEST_IN_PRODUCTION', () => {
    expect(() => getMpConfig(env({ VERCEL_ENV: 'production' }))).toThrow(/Producción requiere/)
    expect(() => getMpConfig(env({ MP_ENV: 'otro' }))).toThrow(/MP_ENV/)
    expect(getMpConfig(PROD_TEST_OK).env).toBe('test')
  })
})

describe('APP_URL: rechazo de formatos peligrosos o inválidos', () => {
  it.each([
    ['usuario y clave', 'https://user:pass@oficioclaro.vercel.app'],
    ['solo usuario', 'https://user@oficioclaro.vercel.app'],
    ['solo clave', 'https://:pass@oficioclaro.vercel.app'],
    ['arroba vacía', 'https://@oficioclaro.vercel.app'],
    ['credenciales con comillas y espacios', ' "https://user:pass@oficioclaro.vercel.app/" '],
    ['host vacío', 'https://'],
    ['host vacío con barra', 'https:///'],
    ['host vacío con ruta', 'http:///x'],
    ['host solo punto', 'https://.'],
    ['etiquetas vacías', 'https://oficioclaro..vercel.app'],
    ['punto inicial', 'https://.oficioclaro.vercel.app'],
    ['guion bajo en el host', 'https://exa_mple.com'],
    ['solo puerto', 'https://:443'],
    ['puerto fuera de rango', 'https://oficioclaro.vercel.app:99999'],
    ['ftp', 'ftp://oficioclaro.vercel.app'],
    ['file', 'file:///etc/passwd'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,hola'],
  ])('%s → MpConfigError', (_n, v) => {
    expect(() => getMpConfig(env({ APP_URL: v }))).toThrow(MpConfigError)
    expect(() => getMpConfig(env({ APP_URL: v, VERCEL_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: 'true' }))).toThrow(MpConfigError)
  })
  it('el error no revela la clave incrustada ni los secretos', () => {
    try { getMpConfig(env({ APP_URL: 'https://user:claveSecreta@oficioclaro.vercel.app' })); throw new Error('no lanzó') }
    catch (e) { const m = String((e as Error).message); expect(m).not.toContain('claveSecreta'); expect(m).not.toContain(TOKEN); expect(m).not.toContain(WHSEC) }
  })
  it('hosts legítimos siguen aceptados: mayúsculas, puerto, localhost, IPv4 e IPv6', () => {
    expect(getMpConfig(env({ APP_URL: 'HTTPS://OficioClaro.Vercel.App' })).appUrl).toBe('https://oficioclaro.vercel.app')
    expect(getMpConfig(env({ APP_URL: 'https://oficioclaro.vercel.app:8443/' })).appUrl).toBe('https://oficioclaro.vercel.app:8443')
    expect(getMpConfig(env({ APP_URL: 'http://localhost:3000', VERCEL_ENV: 'development' })).appUrl).toBe('http://localhost:3000')
    expect(getMpConfig(env({ APP_URL: 'http://127.0.0.1:3000', VERCEL_ENV: 'preview' })).appUrl).toBe('http://127.0.0.1:3000')
    expect(getMpConfig(env({ APP_URL: 'http://[::1]:3000', VERCEL_ENV: 'preview' })).appUrl).toBe('http://[::1]:3000')
  })
  it('Production sigue exigiendo HTTPS (con MP_ENV=production y con prueba autorizada)', () => {
    expect(() => getMpConfig(env({ APP_URL: 'http://oficioclaro.vercel.app', MP_ENV: 'production', VERCEL_ENV: 'production' }))).toThrow(/https/)
    expect(() => getMpConfig(env({ APP_URL: 'http://oficioclaro.vercel.app', VERCEL_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: 'true' }))).toThrow(/https/)
    expect(getMpConfig(env({ APP_URL: 'https://oficioclaro.vercel.app', MP_ENV: 'production', VERCEL_ENV: 'production' })).appUrl).toBe('https://oficioclaro.vercel.app')
  })
})

describe('APP_URL: texto pegado en el medio (caso real "Copiar")', () => {
  const ORIGIN = 'https://oficioclaro.vercel.app'
  it.each([
    ['salto de línea + Copiar', `${ORIGIN}\nCopiar`],
    ['CRLF + Copiar', `${ORIGIN}\r\nCopiar`],
    ['tab + Copiar', `${ORIGIN}\tCopiar`],
    ['espacio + Copiar', `${ORIGIN} Copiar`],
    ['espacio duro + Copiar', `${ORIGIN}\u00a0Copiar`],
    ['Copiar entre dos líneas', `${ORIGIN}\nCopiar\n`],
    ['carácter de control', `${ORIGIN}\u0007x`],
    ['con comillas y texto extra', `"${ORIGIN}\nCopiar"`],
  ])('%s → MpConfigError (nunca …appcopiar)', (_n, v) => {
    expect(() => getMpConfig(env({ APP_URL: v }))).toThrow(MpConfigError)
    expect(() => getMpConfig(env({ APP_URL: v, VERCEL_ENV: 'production', MP_ALLOW_TEST_IN_PRODUCTION: 'true' }))).toThrow(/APP_URL/)
  })
  it('un valor limpio con salto de línea solo al final sigue funcionando', () => {
    expect(getMpConfig(env({ APP_URL: `${ORIGIN}\n` })).appUrl).toBe(ORIGIN)
  })
})


describe('MP_WEBHOOK_SECRET: normalización segura', () => {
  const sec = (v: string | undefined) => getMpConfig(env({ MP_WEBHOOK_SECRET: v }))
  it('valor limpio: sin cambios y sin marca de normalización', () => {
    expect(sec(WHSEC)).toMatchObject({ webhookSecret: WHSEC, webhookSecretNormalizado: false })
  })
  it('espacios, tabs o saltos de línea exteriores: se quitan y queda marcado', () => {
    for (const v of [` ${WHSEC}`, `${WHSEC}\n`, `\r\n${WHSEC}\t `])
      expect(sec(v), JSON.stringify(v).length ? 'ext' : '').toMatchObject({ webhookSecret: WHSEC, webhookSecretNormalizado: true })
  })
  it('comillas envolventes (simples o dobles), con o sin espacios alrededor: se quitan', () => {
    for (const v of [`"${WHSEC}"`, `'${WHSEC}'`, ` "${WHSEC}"\n`, `" ${WHSEC} "`])
      expect(sec(v)).toMatchObject({ webhookSecret: WHSEC, webhookSecretNormalizado: true })
  })
  it('solo un par de comillas: no se pelan en capas ni se tocan comillas sueltas o internas', () => {
    expect(() => sec(`""${WHSEC}""`)).not.toThrow()
    expect(sec(`""${WHSEC}""`).webhookSecret).toBe(`"${WHSEC}"`)
    expect(sec(`"${WHSEC}`).webhookSecret).toBe(`"${WHSEC}`) // comilla suelta: no se adivina
    expect(sec(`AB"CD`).webhookSecret).toBe('AB"CD')
  })
  it('vacío, solo espacios o solo comillas: se trata como no configurado', () => {
    for (const v of [undefined, '', '   ', '\n', '""', "''", ' " " ']) expect(() => sec(v), JSON.stringify(v)).toThrow(/no está configurado/)
  })
  it('espacios o caracteres de control INTERNOS: error de configuración, no se «arregla» y el mensaje no muestra el valor', () => {
    for (const v of ['ab cd', 'ab\ncd', 'ab\tcd', 'ab\u0000cd', 'ab cd']) {
      let msg = ''
      try { sec(v) } catch (e) { msg = (e as Error).message }
      expect(msg, JSON.stringify(v)).toMatch(/MP_WEBHOOK_SECRET contiene espacios/); expect(msg).not.toContain('ab')
    }
  })
  it('un secreto válido con caracteres internos habituales (guiones, guiones bajos, hex) no cambia', () => {
    for (const v of ['a1b2c3d4e5f6-A_B.c', 'f'.repeat(64)]) expect(sec(v).webhookSecret).toBe(v)
  })
  it('las reglas de entorno existentes no cambian con la normalización', () => {
    expect(() => getMpConfig(env({ VERCEL_ENV: 'production', MP_WEBHOOK_SECRET: ` ${WHSEC}\n` }))).toThrow(/Producción requiere/)
  })
})

// Configuración de Mercado Pago. SOLO SERVIDOR: nunca importar desde componentes cliente.
// Variables (ver docs/MERCADOPAGO.md):
//   MP_ACCESS_TOKEN    token privado (de prueba o producción)
//   MP_WEBHOOK_SECRET  clave secreta de Webhooks (panel de MP > tu app > Webhooks)
//   MP_ENV             'test' | 'production' — debe coincidir con el entorno de Vercel
//   APP_URL            URL pública base, sin barra final (https://oficioclaro.com)
//   MP_ALLOW_TEST_IN_PRODUCTION  opcional. Solo el texto exacto 'true' permite MP_ENV=test en Production de Vercel
//                      (para probar con credenciales de prueba, sin cobros reales). Cualquier otro valor o ausencia: se rechaza.

export type MpConfig = { accessToken: string; webhookSecret: string; env: 'test' | 'production'; appUrl: string }

export class MpConfigError extends Error {}

/** Normaliza APP_URL a su origen (esquema + host + puerto). '' = no definida; null = no es una URL http(s) válida.
 *  Recorta espacios/saltos de línea, quita comillas exteriores y descarta barra final, ruta, query y hash. */
function normalizeAppUrl(raw: string | undefined): string | null {
  let v = (raw ?? '').trim()
  const q = v.match(/^(["'])(.*)\1$/s)
  if (q) v = q[2].trim()
  if (!v) return ''
  // Espacios, saltos de línea, tabs o caracteres de control en el MEDIO (texto pegado de más):
  // new URL() los ignora y fusiona el texto con el dominio (…appcopiar), así que se rechaza el valor entero.
  if (/[\s\u0000-\u001f\u007f\u00a0]/.test(v)) return null
  // Se rechaza (no se descarta en silencio) todo lo que no sea http(s)://host[:puerto]: usuario/clave incrustados (incluido '@'
  // vacío), host vacío o con etiquetas inválidas, y cualquier otro protocolo.
  if (!/^https?:\/\/[^/?#\s@]/i.test(v) || /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(v)) return null
  try {
    const u = new URL(v)
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null
    const host = u.hostname
    const validHost = /^\[[0-9a-f:.]+\]$/i.test(host) || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host)
    return validHost ? u.origin : null
  } catch { return null }
}

export function getMpConfig(env: NodeJS.ProcessEnv = process.env): MpConfig {
  const accessToken = env.MP_ACCESS_TOKEN
  const webhookSecret = env.MP_WEBHOOK_SECRET
  const appUrl = normalizeAppUrl(env.APP_URL)
  const mpEnv = env.MP_ENV
  if (!accessToken || !webhookSecret || appUrl === '') throw new MpConfigError('Mercado Pago no está configurado (faltan variables de entorno).')
  if (mpEnv !== 'test' && mpEnv !== 'production') throw new MpConfigError("MP_ENV debe ser 'test' o 'production'.")
  if (appUrl === null) throw new MpConfigError('APP_URL no es una URL válida (ejemplo: https://oficioclaro.vercel.app).')
  // Separación prueba/producción: producción de Vercel exige credenciales de producción y el resto, de prueba.
  // Única excepción: autorización explícita y exacta (MP_ALLOW_TEST_IN_PRODUCTION === 'true') para usar MP_ENV=test en Production.
  const vercelEnv = env.VERCEL_ENV
  const testInProductionAllowed = mpEnv === 'test' && env.MP_ALLOW_TEST_IN_PRODUCTION === 'true'
  if (vercelEnv === 'production' && mpEnv !== 'production' && !testInProductionAllowed) throw new MpConfigError('Producción requiere MP_ENV=production.')
  if (vercelEnv && vercelEnv !== 'production' && mpEnv !== 'test') throw new MpConfigError('Los entornos de preview/desarrollo deben usar MP_ENV=test.')
  // https obligatorio con credenciales de producción y también en el deployment Production (aunque use credenciales de prueba).
  if ((mpEnv === 'production' || vercelEnv === 'production') && !appUrl.startsWith('https://')) throw new MpConfigError('APP_URL debe ser https en producción.')
  return { accessToken, webhookSecret, env: mpEnv, appUrl }
}

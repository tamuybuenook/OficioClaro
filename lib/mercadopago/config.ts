// Configuración de Mercado Pago. SOLO SERVIDOR: nunca importar desde componentes cliente.
// Variables (ver docs/MERCADOPAGO.md):
//   MP_ACCESS_TOKEN    token privado (de prueba o producción)
//   MP_WEBHOOK_SECRET  clave secreta de Webhooks (panel de MP > tu app > Webhooks)
//   MP_ENV             'test' | 'production' — debe coincidir con el entorno de Vercel
//   APP_URL            URL pública base, sin barra final (https://oficioclaro.com)

export type MpConfig = { accessToken: string; webhookSecret: string; env: 'test' | 'production'; appUrl: string }

export class MpConfigError extends Error {}

export function getMpConfig(env: NodeJS.ProcessEnv = process.env): MpConfig {
  const accessToken = env.MP_ACCESS_TOKEN
  const webhookSecret = env.MP_WEBHOOK_SECRET
  const appUrl = (env.APP_URL ?? '').replace(/\/+$/, '')
  const mpEnv = env.MP_ENV
  if (!accessToken || !webhookSecret || !appUrl) throw new MpConfigError('Mercado Pago no está configurado (faltan variables de entorno).')
  if (mpEnv !== 'test' && mpEnv !== 'production') throw new MpConfigError("MP_ENV debe ser 'test' o 'production'.")
  // Separación prueba/producción: producción de Vercel exige credenciales de producción y el resto, de prueba.
  const vercelEnv = env.VERCEL_ENV
  if (vercelEnv === 'production' && mpEnv !== 'production') throw new MpConfigError('Producción requiere MP_ENV=production.')
  if (vercelEnv && vercelEnv !== 'production' && mpEnv !== 'test') throw new MpConfigError('Los entornos de preview/desarrollo deben usar MP_ENV=test.')
  if (mpEnv === 'production' && !appUrl.startsWith('https://')) throw new MpConfigError('APP_URL debe ser https en producción.')
  return { accessToken, webhookSecret, env: mpEnv, appUrl }
}

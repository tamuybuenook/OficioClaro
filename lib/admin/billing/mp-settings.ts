// Diagnóstico de la configuración de Mercado Pago para /admin/configuracion.
// Funciones puras sobre un objeto de entorno: NUNCA devuelven valores de tokens ni secretos, solo si existen.
import { getMpConfig, MpConfigError } from '@/lib/mercadopago/config'

export const WEBHOOK_PATH = '/api/mercadopago/webhook'
export const RECONCILE_PATH = '/api/mercadopago/reconcile'
/** Debe coincidir con vercel.json (hay una prueba que lo verifica). */
export const RECONCILE_CRON_SCHEDULE = '0 9 * * *'
/** Intervalo esperado entre ejecuciones del cron declarado (diario) + margen de Vercel Hobby (±59 min) y de arranque. */
export const RECONCILE_EXPECTED_MAX_AGE_HOURS = 27

export const WEBHOOK_EVENTS = [
  { topic: 'Pagos (payment)', why: 'Cobros únicos y su estado: aprobado, rechazado, reembolsado, contracargo.' },
  { topic: 'Planes y suscripciones (subscription_preapproval)', why: 'Estado de la autorización de renovación automática: autorizada, pausada, cancelada.' },
  { topic: 'Pagos recurrentes (subscription_authorized_payment)', why: 'Cada cobro de la renovación automática.' },
] as const

type VarSpec = { name: string; required: boolean; purpose: string }
const VARS: VarSpec[] = [
  { name: 'MP_ACCESS_TOKEN', required: true, purpose: 'Token privado de la aplicación de Mercado Pago' },
  { name: 'MP_WEBHOOK_SECRET', required: true, purpose: 'Clave secreta de Webhooks (firma x-signature)' },
  { name: 'MP_ENV', required: true, purpose: "'test' en Preview, 'production' en Production" },
  { name: 'APP_URL', required: true, purpose: 'URL pública https, sin barra final' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, purpose: 'Acceso del servidor para registrar pagos desde el webhook' },
  { name: 'CRON_SECRET', required: false, purpose: 'Habilita la conciliación periódica (sin él la ruta queda deshabilitada)' },
]

export type MpSettings = {
  env: 'test' | 'production' | 'invalid' | 'missing'
  vercelEnv: string | null
  vars: { name: string; required: boolean; present: boolean; purpose: string }[]
  missingRequired: string[]
  coherence: { state: 'ok' | 'mismatch' | 'unknown'; message: string }
  appUrl: { value: string | null; issues: string[] }
  webhookUrl: string | null
  reconcileUrl: string | null
  cronSecretPresent: boolean
  configError: string | null     // mensaje de getMpConfig (no contiene valores)
  ready: boolean                 // configuración completa y coherente (no implica validada contra MP real)
}

const has = (v: string | undefined) => typeof v === 'string' && v.trim().length > 0

export function computeMpSettings(env: NodeJS.ProcessEnv = process.env): MpSettings {
  const mp = env.MP_ENV
  const mpEnv: MpSettings['env'] = !has(mp) ? 'missing' : mp === 'test' || mp === 'production' ? mp : 'invalid'
  const vercelEnv = has(env.VERCEL_ENV) ? (env.VERCEL_ENV as string) : null
  const vars = VARS.map((v) => ({ ...v, present: has(env[v.name]) }))
  const missingRequired = vars.filter((v) => v.required && !v.present).map((v) => v.name)

  let coherence: MpSettings['coherence']
  if (mpEnv === 'missing' || mpEnv === 'invalid') coherence = { state: 'unknown', message: "MP_ENV falta o no es 'test' ni 'production'." }
  else if (!vercelEnv) coherence = { state: 'unknown', message: 'Sin VERCEL_ENV (ejecución local o fuera de Vercel): no se puede comprobar la coherencia.' }
  else if (vercelEnv === 'production') coherence = mpEnv === 'production'
    ? { state: 'ok', message: 'Production usa MP_ENV=production.' }
    : { state: 'mismatch', message: "Production exige MP_ENV=production (hoy: 'test')." }
  else coherence = mpEnv === 'test'
    ? { state: 'ok', message: `${vercelEnv === 'preview' ? 'Preview' : 'Development'} usa MP_ENV=test.` }
    : { state: 'mismatch', message: `${vercelEnv} debe usar MP_ENV=test (hoy: 'production'): riesgo de cobros reales fuera de producción.` }

  const raw = (env.APP_URL ?? '').trim()
  const value = raw ? raw.replace(/\/+$/, '') : null
  const issues: string[] = []
  if (!value) issues.push('APP_URL no está definida.')
  else {
    let url: URL | null = null
    if (/[\s\u0000-\u001f\u007f\u00a0"']/.test(value)) issues.push('APP_URL no es una URL válida: contiene espacios, saltos de línea, comillas o texto extra (¿se pegó "Copiar"?). Escribila a mano.')
    else try { url = new URL(value) } catch { issues.push('APP_URL no es una URL válida.') }
    if (url) {
      if (url.protocol !== 'https:') issues.push(mpEnv === 'production' ? 'En producción APP_URL debe ser https.' : 'Mercado Pago requiere https para el retorno automático (auto_return).')
      if (['localhost', '127.0.0.1'].includes(url.hostname) && mpEnv === 'production') issues.push('APP_URL apunta a localhost en producción.')
      if (url.pathname !== '/' || url.search || url.hash) issues.push('APP_URL debe ser solo el origen (sin ruta ni parámetros).')
    }
    if (raw.endsWith('/')) issues.push('APP_URL termina en "/": se ignora la barra, conviene quitarla.')
  }

  let configError: string | null = null
  try { getMpConfig(env) } catch (e) { configError = e instanceof MpConfigError ? e.message : 'Configuración inválida.' }

  const origin = value && !issues.some((i) => i.includes('válida')) ? value : null
  return {
    env: mpEnv, vercelEnv, vars, missingRequired, coherence, appUrl: { value, issues },
    webhookUrl: origin ? `${origin}${WEBHOOK_PATH}` : null,
    reconcileUrl: origin ? `${origin}${RECONCILE_PATH}` : null,
    cronSecretPresent: has(env.CRON_SECRET), configError,
    ready: configError === null && coherence.state !== 'mismatch',
  }
}

// ---- Estado de la conciliación (según lo que dejó registrado el cron en audit_logs) ----
export type ReconcileLog = { action: string; created_at: string; new_value: any }
export type ReconcileState = 'disabled' | 'never' | 'ok' | 'failed' | 'stale'
export type ReconcileStatus = { state: ReconcileState; message: string; last: ReconcileLog | null }

/**
 * `last` = el registro más reciente (éxito o fallo). Solo se considera "ok" una ejecución exitosa reciente.
 * Nunca afirma que el cron "está activo": solo informa lo que se ejecutó realmente y cuándo.
 */
export function evaluateReconcile(last: ReconcileLog | null, o: { cronSecretPresent: boolean; now?: Date; maxAgeHours?: number }): ReconcileStatus {
  if (!o.cronSecretPresent) return { state: 'disabled', message: 'CRON_SECRET no está definido: la ruta de conciliación responde "deshabilitada" y el cron no puede autenticarse.', last }
  if (!last) return { state: 'never', message: 'Sin ejecuciones registradas. Que haya un cron declarado no prueba que esté activo: verificá en Vercel y con una ejecución real.', last: null }
  const now = o.now ?? new Date()
  const ageH = (now.getTime() - new Date(last.created_at).getTime()) / 3600_000
  if (last.action === 'mp_reconcile_failed') return { state: 'failed', message: 'La última ejecución falló.', last }
  if (ageH > (o.maxAgeHours ?? RECONCILE_EXPECTED_MAX_AGE_HOURS)) return { state: 'stale', message: `Última ejecución exitosa hace ${Math.floor(ageH)} h: más de lo esperado para la programación declarada.`, last }
  return { state: 'ok', message: 'La última ejecución terminó bien dentro del intervalo esperado.', last }
}

// Registro de fallos de Mercado Pago para los logs del servidor. Nunca lanza y nunca imprime tokens, cookies, claves ni emails.
import { MpApiError, sanitizeMpText } from './client'

type Ctx = Record<string, string | number | boolean | null | undefined>

export function logMpFailure(scope: string, e: unknown, ctx: Ctx = {}): void {
  try {
    const info = e instanceof MpApiError
      ? { kind: 'mp_api', status: e.status, message: sanitizeMpText(e.message), detail: e.detail === undefined ? undefined : sanitizeMpText(e.detail) }
      : { kind: 'error', name: (e as Error)?.name ?? typeof e, message: sanitizeMpText((e as Error)?.message) }
    console.error(`[mp] ${scope}`, JSON.stringify({ ...ctx, ...info }))
  } catch { /* el registro nunca debe romper el flujo */ }
}

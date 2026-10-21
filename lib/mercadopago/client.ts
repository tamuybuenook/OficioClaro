// Cliente mínimo de la API de Mercado Pago (fetch nativo, sin SDK). SOLO SERVIDOR.
import { getMpConfig } from './config'

export class MpApiError extends Error {
  /** Motivo saneado informado por MP (solo campos permitidos). Nunca contiene tokens, emails ni el cuerpo completo. */
  constructor(public status: number, message: string, public detail?: string) { super(message) }
}

/** Quita de un texto todo lo que pueda ser sensible (tokens, JWT, emails, números largos) y lo acota. */
export function sanitizeMpText(input: unknown, max = 200): string {
  return String(input ?? '')
    .replace(/Bearer\s+\S+/gi, '[token]')
    .replace(/\b(?:APP_USR|TEST)-[\w-]+/gi, '[token]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[token]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\d{6,}/g, '[num]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

// Solo se extraen campos conocidos de la respuesta de error de MP (error, message, cause[].code/description).
function mpErrorDetail(raw: string): string | undefined {
  try {
    const j = JSON.parse(raw) as any
    const parts: string[] = []
    if (typeof j?.error === 'string') parts.push(`error=${j.error}`)
    if (typeof j?.message === 'string') parts.push(`message=${j.message}`)
    if (Array.isArray(j?.cause))
      for (const c of j.cause.slice(0, 3)) parts.push(`cause=${c?.code ?? '?'}:${typeof c?.description === 'string' ? c.description : ''}`)
    return parts.length ? sanitizeMpText(parts.join(' | ')) : undefined
  } catch { return undefined }
}

export type MpClient = {
  request<T = any>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, idempotencyKey?: string): Promise<T>
}

// El token nunca se incluye en mensajes de error ni en logs.
export function createMpClient(config = getMpConfig(), fetchImpl: typeof fetch = fetch): MpClient {
  return {
    async request(method, path, body, idempotencyKey) {
      let res: Response
      try {
        res = await fetchImpl(`https://api.mercadopago.com${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
          cache: 'no-store',
        })
      } catch {
        throw new MpApiError(0, `No se pudo contactar a Mercado Pago (${method} ${path.split('?')[0]})`)
      }
      if (!res.ok) {
        const raw = await res.text().then((t) => t.slice(0, 4000)).catch(() => '')
        throw new MpApiError(res.status, `Mercado Pago respondió ${res.status} (${method} ${path.split('?')[0]})`, mpErrorDetail(raw))
      }
      return (await res.json()) as any
    },
  }
}

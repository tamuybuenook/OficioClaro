// Cliente mínimo de la API de Mercado Pago (fetch nativo, sin SDK). SOLO SERVIDOR.
import { getMpConfig } from './config'

export class MpApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
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
      if (!res.ok) throw new MpApiError(res.status, `Mercado Pago respondió ${res.status} (${method} ${path.split('?')[0]})`)
      return (await res.json()) as any
    },
  }
}

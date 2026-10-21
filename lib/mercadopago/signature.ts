import { createHmac, timingSafeEqual } from 'node:crypto'

// Validación oficial de webhooks de MP: header x-signature "ts=...,v1=..." y x-request-id.
// manifest = `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` firmado con HMAC-SHA256 (hex).
// Si data.id es alfanumérico, MP lo firma en minúsculas.
export function verifyMpSignature(opts: { secret: string; signatureHeader: string | null; requestId: string | null; dataId: string | null }): boolean {
  const { secret, signatureHeader, requestId, dataId } = opts
  if (!secret || !signatureHeader || !requestId || !dataId) return false
  let ts: string | undefined
  let v1: string | undefined
  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=', 2).map((x) => x?.trim())
    if (k === 'ts') ts = v
    else if (k === 'v1') v1 = v
  }
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId
  const expected = createHmac('sha256', secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest()
  return timingSafeEqual(expected, Buffer.from(v1, 'hex'))
}

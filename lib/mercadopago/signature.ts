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

export type SignatureRejection = {
  categoria: 'falta_x_signature' | 'falta_x_request_id' | 'falta_data_id' | 'formato_invalido' | 'firma_no_coincide'
  /** Solo en 'firma_no_coincide': ¿el secreto configurado tiene espacios o saltos de línea al principio o al final? (nunca el valor) */
  secreto_espacios_borde?: boolean
  /** Solo en 'firma_no_coincide': segundos entre el ts de la firma y ahora (null si no es calculable). */
  ts_edad_s?: number | null
}

/**
 * SOLO DIAGNÓSTICO: se llama después de que verifyMpSignature devolvió false para indicar el motivo. No decide nada ni acepta nada.
 * Devuelve únicamente categorías y datos no sensibles: nunca el secreto, la firma, los encabezados ni los identificadores.
 */
export function describeSignatureRejection(
  opts: { secret: string; signatureHeader: string | null; requestId: string | null; dataId: string | null },
  now: () => number = Date.now,
): SignatureRejection {
  const { secret, signatureHeader, requestId, dataId } = opts
  if (!signatureHeader) return { categoria: 'falta_x_signature' }
  if (!requestId) return { categoria: 'falta_x_request_id' }
  if (!dataId) return { categoria: 'falta_data_id' }
  let ts: string | undefined
  let v1: string | undefined
  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=', 2).map((x) => x?.trim())
    if (k === 'ts') ts = v
    else if (k === 'v1') v1 = v
  }
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return { categoria: 'formato_invalido' }
  let edad: number | null = null
  if (/^\d{1,16}$/.test(ts)) {
    const n = Number(ts)
    const tsSeg = n > 1e12 ? n / 1000 : n // MP puede enviar ts en segundos o en milisegundos
    edad = Math.round(now() / 1000 - tsSeg)
  }
  return { categoria: 'firma_no_coincide', secreto_espacios_borde: secret !== secret.trim(), ts_edad_s: edad }
}

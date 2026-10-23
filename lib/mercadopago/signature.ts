import { createHmac, timingSafeEqual } from 'node:crypto'

// Validación oficial de webhooks de MP: header x-signature "ts=...,v1=..." y x-request-id.
// Manifest (SDK oficial mercadopago/sdk-nodejs, src/utils/webhook): `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` firmado con HMAC-SHA256 (hex).
// Regla documentada del SDK: el par cuyo valor falta se OMITE (p. ej. sin data.id el manifest es `request-id:<…>;ts:<…>;`).
// Si data.id es alfanumérico, MP lo firma en minúsculas (el SDK lo conserva tal cual: divergencia conocida y sin cambios; no afecta ids numéricos ni hex en minúscula).
// Mantenido a propósito MÁS estricto que el SDK: x-request-id sigue siendo obligatorio, y data.id lo sigue siendo salvo que el llamador lo autorice
// explícitamente (`allowMissingDataId`, hoy solo la ruta del webhook para merchant_order). El id de IPN o del cuerpo NUNCA sustituyen a data.id de la query.

/** Construcción del manifest idéntica a la del SDK oficial (buildManifest): pares ausentes omitidos, `;` final. `id` ya viene normalizado por el llamador. */
export function buildMpManifest(id: string | null | undefined, requestId: string | null | undefined, ts: string): string {
  const parts: string[] = []
  if (id) parts.push(`id:${id}`)
  if (requestId) parts.push(`request-id:${requestId}`)
  parts.push(`ts:${ts}`)
  return parts.join(';') + ';'
}

export function verifyMpSignature(opts: { secret: string; signatureHeader: string | null; requestId: string | null; dataId: string | null; allowMissingDataId?: boolean }): boolean {
  const { secret, signatureHeader, requestId, dataId, allowMissingDataId } = opts
  if (!secret || !signatureHeader || !requestId) return false
  if (!dataId && !allowMissingDataId) return false
  let ts: string | undefined
  let v1: string | undefined
  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=', 2).map((x) => x?.trim())
    if (k === 'ts') ts = v
    else if (k === 'v1') v1 = v
  }
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false
  const id = dataId && /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId
  const expected = createHmac('sha256', secret).update(buildMpManifest(id, requestId, ts)).digest()
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
  opts: { secret: string; signatureHeader: string | null; requestId: string | null; dataId: string | null; allowMissingDataId?: boolean },
  now: () => number = Date.now,
): SignatureRejection {
  const { secret, signatureHeader, requestId, dataId, allowMissingDataId } = opts
  if (!signatureHeader) return { categoria: 'falta_x_signature' }
  if (!requestId) return { categoria: 'falta_x_request_id' }
  if (!dataId && !allowMissingDataId) return { categoria: 'falta_data_id' }
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

// ───────── SOLO DIAGNÓSTICO (no participan en la validación ni la modifican) ─────────
// Todo lo devuelto es presencia, forma y longitudes: nunca ts, v1, request-id ni identificadores.

export type SignatureStructure = {
  presente: boolean
  partes: number
  partes_desconocidas: number
  ts: 'ok' | 'falta' | 'vacio'
  ts_forma: 'segundos' | 'milisegundos' | 'otro' | null
  ts_digitos: number | null
  v1: 'ok_hex64' | 'falta' | 'vacio' | 'no_hex64'
  v1_largo: number | null
}

/** Estructura reconocida de x-signature con el MISMO criterio de lectura que verifyMpSignature (partes `k=v` separadas por coma). */
export function describeSignatureStructure(header: string | null): SignatureStructure {
  if (!header) return { presente: false, partes: 0, partes_desconocidas: 0, ts: 'falta', ts_forma: null, ts_digitos: null, v1: 'falta', v1_largo: null }
  let ts: string | undefined
  let v1: string | undefined
  let partes = 0
  let desconocidas = 0
  for (const part of header.split(',')) {
    partes++
    const [k, v] = part.split('=', 2).map((x) => x?.trim())
    if (k === 'ts') ts = v ?? ''
    else if (k === 'v1') v1 = v ?? ''
    else desconocidas++
  }
  const tsDigitos = ts && /^\d+$/.test(ts) ? ts.length : null
  return {
    presente: true, partes, partes_desconocidas: desconocidas,
    ts: ts === undefined ? 'falta' : ts === '' ? 'vacio' : 'ok',
    ts_forma: tsDigitos === null ? (ts ? 'otro' : null) : tsDigitos >= 13 ? 'milisegundos' : tsDigitos >= 9 ? 'segundos' : 'otro',
    ts_digitos: tsDigitos,
    v1: v1 === undefined ? 'falta' : v1 === '' ? 'vacio' : /^[0-9a-f]{64}$/i.test(v1) ? 'ok_hex64' : 'no_hex64',
    v1_largo: v1 === undefined ? null : v1.length,
  }
}

export type ManifestInputs = {
  /** Plantilla EXACTA que arma verifyMpSignature (los valores nunca se registran). Sin data.id el par `id:` se omite, como en el SDK. */
  plantilla: 'id:<data.id de la query>;request-id:<x-request-id>;ts:<ts de x-signature>;' | 'request-id:<x-request-id>;ts:<ts de x-signature>;'
  id: { presente: boolean; origen: 'query'; forma: 'numerico' | 'alfanumerico' | 'otro' | null; largo: number | null; minusculas_cambia_valor: boolean }
  request_id: { presente: boolean; origen: 'cabecera x-request-id'; largo: number | null }
  ts: { presente: boolean; origen: 'cabecera x-signature (ts)' }
}

/** Qué datos componen el manifest hoy, de dónde sale cada uno y si está presente. */
export function describeManifestInputs(opts: { signatureHeader: string | null; requestId: string | null; dataId: string | null }): ManifestInputs {
  const { signatureHeader, requestId, dataId } = opts
  const s = describeSignatureStructure(signatureHeader)
  return {
    plantilla: dataId ? 'id:<data.id de la query>;request-id:<x-request-id>;ts:<ts de x-signature>;' : 'request-id:<x-request-id>;ts:<ts de x-signature>;',
    id: {
      presente: !!dataId, origen: 'query',
      forma: !dataId ? null : /^\d+$/.test(dataId) ? 'numerico' : /^[a-z0-9]+$/i.test(dataId) ? 'alfanumerico' : 'otro',
      largo: dataId ? dataId.length : null,
      minusculas_cambia_valor: !!dataId && /^[a-z0-9]+$/i.test(dataId) && dataId !== dataId.toLowerCase(),
    },
    request_id: { presente: !!requestId, origen: 'cabecera x-request-id', largo: requestId ? requestId.length : null },
    ts: { presente: s.ts === 'ok', origen: 'cabecera x-signature (ts)' },
  }
}

// ───────── SOLO DIAGNÓSTICO: ¿con qué manifest coincide la firma recibida? ─────────
// Nunca decide ni acepta nada. Sirve para distinguir «secreto equivocado» (ninguna variante coincide) de «manifest distinto»
// (coincide una variante). Devuelve solo booleanos: jamás el secreto, la firma, el request-id ni los identificadores.

export type ManifestVariantsDiagnosis = {
  solo_diagnostico: true
  /** Manifest del SDK con el par `id:` omitido (lo que hoy se prueba cuando falta data.id). */
  sin_id: boolean
  /** Manifest con el `id` del IPN tal cual. null si no hay id de IPN. */
  con_id_ipn: boolean | null
  /** Igual pero con el id del IPN en minúsculas (solo si difiere del anterior). */
  con_id_ipn_minusculas: boolean | null
}

export function diagnoseManifestVariants(opts: { secret: string; signatureHeader: string | null; requestId: string | null; ipnId: string | null }): ManifestVariantsDiagnosis | null {
  const { secret, signatureHeader, requestId, ipnId } = opts
  if (!secret || !signatureHeader) return null
  let ts: string | undefined
  let v1: string | undefined
  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=', 2).map((x) => x?.trim())
    if (k === 'ts') ts = v
    else if (k === 'v1') v1 = v
  }
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return null
  const received = Buffer.from(v1, 'hex')
  const matches = (id: string | null) => timingSafeEqual(createHmac('sha256', secret).update(buildMpManifest(id, requestId, ts!)).digest(), received)
  const lower = ipnId ? ipnId.toLowerCase() : null
  return {
    solo_diagnostico: true,
    sin_id: matches(null),
    con_id_ipn: ipnId ? matches(ipnId) : null,
    con_id_ipn_minusculas: ipnId && lower !== ipnId ? matches(lower) : null,
  }
}

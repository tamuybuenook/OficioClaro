// MODO «SOLO RECEPCIÓN» (temporal, solo pruebas). Confirma con HTTP 200 que la notificación llegó; NO significa que el pago esté aprobado.
//
// Aislamiento (por construcción, no por convención):
//  1. Solo se activa con MP_ENV='test' (ya validado por getMpConfig) Y MP_WEBHOOK_RECEIPT_ONLY exactamente 'true'. Cualquier otro valor o ausencia: desactivado.
//     Con MP_ENV='production' es imposible activarlo, aunque la variable exista.
//  2. recordUnverifiedReceipt recibe SOLO `logEvent` y `finishEvent` (tipo Pick). No tiene acceso a pagos, suscripciones, accesos ni al cliente de MP.
//  3. Nunca guarda el data.id ni el id de IPN no verificados, ni la firma, ni cabeceras, ni el cuerpo: solo tópico, razón y presencia de datos.
import type { MpStore } from './store'

export const RECEIPT_ONLY_FLAG = 'MP_WEBHOOK_RECEIPT_ONLY'
export const RECEIPT_ONLY_OUTCOME = 'received_unverified'

/** `mpEnv` debe venir de getMpConfig() (ya validado contra VERCEL_ENV), no de process.env directamente. */
export function isReceiptOnlyMode(mpEnv: 'test' | 'production', env: NodeJS.ProcessEnv = process.env): boolean {
  return mpEnv === 'test' && env[RECEIPT_ONLY_FLAG] === 'true'
}

export type ReceiptReason = 'firma_no_verificada' | 'falta_data_id' | 'falta_x_request_id' | 'falta_x_signature' | 'formato_invalido' | 'ids_contradictorios'
export type ReceiptInfo = {
  topic: string | null
  /** Solo se guarda si tiene formato seguro; si no, null. */
  requestId: string | null
  reason: ReceiptReason
  formato: 'ipn' | 'webhook'
  firmaVerificada: boolean
  idPresente: boolean
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Registra la recepción. No toma ninguna decisión financiera. Devuelve el id del registro (o null si no se pudo guardar). */
export async function recordUnverifiedReceipt(store: Pick<MpStore, 'logEvent' | 'finishEvent'>, info: ReceiptInfo): Promise<string | null> {
  const requestId = info.requestId && SAFE_REQUEST_ID.test(info.requestId) ? info.requestId : null
  const eventId = await store.logEvent({ topic: info.topic, dataId: null, requestId })
  await store.finishEvent(
    eventId,
    RECEIPT_ONLY_OUTCOME,
    `solo recepción: no se procesó nada · razón=${info.reason} · formato=${info.formato} · firma_verificada=${info.firmaVerificada} · id_presente=${info.idPresente}`,
  )
  return eventId
}

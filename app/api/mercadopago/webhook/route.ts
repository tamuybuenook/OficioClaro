import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getMpConfig } from '@/lib/mercadopago/config'
import { describeManifestInputs, describeSignatureRejection, describeSignatureStructure, verifyMpSignature } from '@/lib/mercadopago/signature'
import { createMpClient, MpApiError, type MpClient } from '@/lib/mercadopago/client'
import { createSupabaseMpStore, type MpStore } from '@/lib/mercadopago/store'
import { processMpEvent } from '@/lib/mercadopago/process-event'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Trazabilidad: una línea JSON por etapa con el prefijo [MP_WEBHOOK_TRACE]. `seguimiento` es un identificador aleatorio de ESTA petición.
// Nunca se registra: secreto, token, firma, cabeceras, cuerpo, request-id, ni el id del pago/evento (solo presencia y categorías).
type Etapa = 'entrada' | 'firma' | 'evento' | 'consulta_mp' | 'procesamiento' | 'persistencia' | 'salida'
const makeTrace = (seguimiento: string, level: 'info' | 'error' = 'info') =>
  (etapa: Etapa, campos: Record<string, unknown>, lvl: 'info' | 'error' = level) => {
    try { console[lvl]('[MP_WEBHOOK_TRACE]', JSON.stringify({ seguimiento, etapa, ...campos })) } catch { /* el registro nunca altera la respuesta */ }
  }
type Trace = ReturnType<typeof makeTrace>

const SAFE_TOPIC = /^[a-z_]{1,40}$/
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const safeTopic = (v: unknown) => (typeof v === 'string' && SAFE_TOPIC.test(v) ? v : null)

type Body = { type: string | null; action: string | null; liveMode: boolean | null; dataId: string | null; dataIdInvalido: boolean; json: boolean }
const NO_BODY: Body = { type: null, action: null, liveMode: null, dataId: null, dataIdInvalido: false, json: false }

/** Cuerpo JSON de la notificación (acotado). Solo se extraen `type`, `action`, `live_mode` y `data.id` con formato seguro; el resto se descarta. */
async function readBody(request: NextRequest): Promise<Body> {
  try {
    const text = (await request.text()).slice(0, 20_000)
    const j = JSON.parse(text) as { type?: unknown; action?: unknown; live_mode?: unknown; data?: { id?: unknown } }
    const rawId = j?.data?.id
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null
    return {
      type: safeTopic(j?.type), action: typeof j?.action === 'string' && /^[a-z_.]{1,60}$/.test(j.action) ? j.action : null,
      liveMode: typeof j?.live_mode === 'boolean' ? j.live_mode : null,
      dataId: id && SAFE_ID.test(id) ? id : null, dataIdInvalido: id !== null && !SAFE_ID.test(id), json: true,
    }
  } catch { return NO_BODY }
}
const forma = (id: string | null) => (!id ? null : /^\d+$/.test(id) ? 'numerico' : /^[a-z0-9]+$/i.test(id) ? 'alfanumerico' : 'otro')

// Envoltorio del cliente de MP solo para trazar: no cambia la consulta autenticada ni sus errores. El id nunca se registra (se enmascara en la ruta).
function tracedClient(mp: MpClient, trace: Trace): MpClient {
  const request = (async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, key?: string) => {
    const recurso = path.split('?')[0].replace(/\/([^/]+)$/, (m, last) => (last === 'search' ? m : '/:id'))
    trace('consulta_mp', { fase: 'inicio', metodo: method, recurso })
    try {
      const res = await mp.request(method, path, body, key)
      trace('consulta_mp', { fase: 'resultado', recurso, http: '2xx' })
      return res
    } catch (e) {
      trace('consulta_mp', { fase: 'resultado', recurso, http: e instanceof MpApiError ? e.status : null, error: e instanceof MpApiError ? (e.status === 0 ? 'red_o_timeout' : 'http') : 'otro' }, 'error')
      throw e
    }
  }) as MpClient['request']
  return { request }
}

// Webhook de Mercado Pago. Respuestas: 401 firma inválida (o falta data.id fuera de merchant_order) · 400 id de evento contradictorio · 200 procesada/ignorada/rechazada por negocio · 500 error transitorio (MP reintenta).
export async function POST(request: NextRequest) {
  const t0 = Date.now()
  const seguimiento = randomBytes(4).toString('hex')
  const trace = makeTrace(seguimiento)
  const salida = (status: number, body: Record<string, unknown>) => {
    trace('salida', { http: status, duracion_ms: Date.now() - t0 }, status >= 500 ? 'error' : 'info')
    return NextResponse.json(body, { status })
  }

  const url = new URL(request.url)
  const dataId = url.searchParams.get('data.id')
  const requestId = request.headers.get('x-request-id')
  const signatureHeader = request.headers.get('x-signature')
  const body = await readBody(request)
  // `ipn` = aviso viejo (?id=…&topic=…, sin data.id; MP documenta que no se puede validar con la clave secreta).
  const formato = !dataId && url.searchParams.has('id') && url.searchParams.has('topic') ? 'ipn' : 'webhook'
  const typeQuery = safeTopic(url.searchParams.get('type'))
  const topicQuery = safeTopic(url.searchParams.get('topic'))
  const topic = typeQuery ?? topicQuery ?? body.type
  const bothIds = !!dataId && body.dataId !== null
  trace('entrada', {
    metodo: request.method, formato, topic,
    type_query: typeQuery, topic_query: topicQuery, type_cuerpo: body.type, action_cuerpo: body.action, live_mode_cuerpo: body.liveMode,
    cuerpo_json: body.json,
    presentes: {
      x_signature: !!signatureHeader, x_request_id: !!requestId, data_id_query: !!dataId, data_id_cuerpo: body.dataId !== null,
      id_query_ipn: url.searchParams.has('id'), // aviso viejo (?id=…&topic=…): NO es data.id y no se usa en el manifest
    },
    ids: {
      query_forma: forma(dataId), cuerpo_forma: forma(body.dataId), cuerpo_formato_invalido: body.dataIdInvalido,
      ambos_presentes: bothIds, coinciden: bothIds ? body.dataId === dataId : null,
      fuente_usada_para_firmar: dataId ? 'query' : 'ninguna', // el código solo firma con la query; el cuerpo nunca entra al cálculo
      fuente_usada_para_procesar: dataId ? 'query' : 'ninguna',
    },
    x_signature_estructura: describeSignatureStructure(signatureHeader),
    x_request_id_largo: requestId ? requestId.length : null,
  })

  let config
  try { config = getMpConfig() } catch {
    trace('entrada', { resultado: 'configuracion_incompleta' }, 'error')
    return salida(500, { error: 'not_configured' })
  }

  // La firma se calcula SOLO con el data.id de la query, como indica el manifest de Mercado Pago. El id del cuerpo ni el `id` del IPN entran nunca al cálculo.
  // Única excepción (prueba diagnóstica): un aviso `merchant_order` SIN data.id en la query NI en el cuerpo se valida con el manifest del SDK oficial
  // (par `id:` omitido). Si la firma es válida solo se registra como «ignored»: no se consulta a MP, no se procesa nada, no se toca ninguna suscripción.
  // Cualquier otro tópico sin data.id (payment, subscription_*…) sigue rechazándose como antes.
  const sinIdPermitido = !dataId && body.dataId === null && !body.dataIdInvalido && topic === 'merchant_order'
  const sigInput = { secret: config.webhookSecret, signatureHeader, requestId, dataId, allowMissingDataId: sinIdPermitido }
  const manifest = describeManifestInputs({ signatureHeader, requestId, dataId })
  const entorno = { mp_env: config.env, vercel_env: process.env.VERCEL_ENV ?? null, secreto_normalizado: config.webhookSecretNormalizado === true }
  if (!verifyMpSignature(sigInput)) {
    const r = describeSignatureRejection(sigInput)
    // `motivo`: causa técnica concreta dentro de la categoría. Solo describe; no cambia ninguna decisión.
    const motivo =
      r.categoria === 'falta_data_id' ? (formato === 'ipn' ? 'ipn_sin_data_id' : body.dataId ? 'id_solo_en_cuerpo' : 'sin_id_en_query_ni_cuerpo')
      : r.categoria === 'formato_invalido' ? `ts_${describeSignatureStructure(signatureHeader).ts}_v1_${describeSignatureStructure(signatureHeader).v1}`
      : r.categoria === 'firma_no_coincide' ? (sinIdPermitido ? 'hmac_distinto_manifest_sin_id' : 'hmac_distinto')
      : r.categoria
    trace('firma', {
      resultado: 'rechazada', ...r, motivo, manifest, ...entorno,
      ...(r.categoria === 'firma_no_coincide' ? { pistas: { ids_contradictorios: bothIds && body.dataId !== dataId, live_mode_cuerpo: body.liveMode } } : {}),
    }, 'error')
    return salida(401, { error: 'invalid_signature' })
  }
  trace('firma', { resultado: 'aceptada', manifest, ...entorno })

  if (sinIdPermitido) {
    trace('evento', { topic, resultado: 'ignorado_merchant_order_sin_data_id', manifest_sin_id: true })
    let store: MpStore
    try { store = createSupabaseMpStore(createAdminClient()) } catch {
      trace('persistencia', { operacion: 'crear_cliente', resultado: 'error' }, 'error')
      return salida(500, { error: 'retry' })
    }
    const eventId = await store.logEvent({ topic, dataId: null, requestId })
    trace('persistencia', { operacion: 'logEvent', resultado: eventId ? 'registrado' : 'no_registrado' }, eventId ? 'info' : 'error')
    await store.finishEvent(eventId, 'ignored', 'merchant_order sin data.id: firma válida (manifest sin id), sin efecto')
    trace('procesamiento', { resultado: 'ignored', motivo: 'merchant_order_sin_data_id' })
    return salida(200, { ok: true, outcome: 'ignored' })
  }

  // Firma válida pero el cuerpo nombra otro recurso que la query: ambiguo, no se procesa nada.
  if (body.dataIdInvalido || (body.dataId !== null && body.dataId !== dataId)) {
    trace('evento', { topic, resultado: 'id_contradictorio', motivo: body.dataIdInvalido ? 'cuerpo_formato_invalido' : 'query_y_cuerpo_distintos' }, 'error')
    return salida(400, { error: 'ambiguous_event_id' })
  }
  trace('evento', { topic, resultado: 'aceptado' })

  let store: MpStore
  try { store = createSupabaseMpStore(createAdminClient()) } catch {
    trace('persistencia', { operacion: 'crear_cliente', resultado: 'error' }, 'error')
    return salida(500, { error: 'retry' })
  }
  const eventId = await store.logEvent({ topic, dataId, requestId })
  trace('persistencia', { operacion: 'logEvent', resultado: eventId ? 'registrado' : 'no_registrado' }, eventId ? 'info' : 'error')

  try {
    const result = await processMpEvent({ mp: tracedClient(createMpClient(config), trace), store }, { topic, dataId: dataId! })
    trace('procesamiento', { resultado: result.outcome })
    await store.finishEvent(eventId, result.outcome, result.detail)
    return salida(200, { ok: true, outcome: result.outcome })
  } catch (e: any) {
    // Sin mensaje de la excepción (puede traer datos): solo tipo de error y, si es de MP, el código HTTP ya trazado en consulta_mp.
    trace('procesamiento', { resultado: 'error', error: e instanceof MpApiError ? 'mp_api' : (typeof e?.name === 'string' && /^\w{1,40}$/.test(e.name) ? e.name : 'desconocido') }, 'error')
    await Promise.resolve(store.finishEvent(eventId, 'error', e?.message ?? 'error')).catch(() => undefined)
    return salida(500, { error: 'retry' })
  }
}

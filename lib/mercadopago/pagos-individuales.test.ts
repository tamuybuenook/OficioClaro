import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { MpApiError, type MpClient } from './client'
import { processMpEvent } from './process-event'
import { diagnoseManifestVariants, verifyMpSignature } from './signature'
import { recordUnverifiedReceipt, RECEIPT_ONLY_OUTCOME } from './receipt-only'
import type { MpStore } from './store'

// Pagos individuales (Checkout Pro). Datos sintéticos; sin red, sin base, sin cargos.
const INTENT = '22222222-2222-2222-2222-222222222222'
const SUB = '33333333-3333-3333-3333-333333333333'

function store(over: Partial<MpStore> = {}) {
  const calls: Record<string, any[]> = {}
  const rec = (k: string) => (...a: any[]) => { (calls[k] ??= []).push(a); }
  const s = {
    getIntent: async (id: string) => (id === INTENT ? { id, subscription_id: SUB } : null),
    recordPayment: async (a: any) => { rec('recordPayment')(a); return { outcome: 'processed' } },
    logIncident: async (...a: any[]) => { rec('logIncident')(...a) },
    traceDeletedPayment: async () => null,
    // Cualquier otra operación sobre suscripciones/accesos desde este flujo sería un error: se registra para poder afirmarlo.
    createLapsedSubscription: async () => { rec('createLapsedSubscription')(); return {} as any },
    setPreapprovalStatus: async () => { rec('setPreapprovalStatus')() },
    ...over,
  } as unknown as MpStore
  return { s, calls }
}
const mp = (payment: any | Error | undefined): MpClient => ({
  request: (async (_m: string, path: string) => {
    if (!path.startsWith('/v1/payments/')) throw new Error(`consulta inesperada: ${path}`)
    if (payment === undefined) throw new MpApiError(404, 'nf')
    if (payment instanceof Error) throw payment
    return payment
  }) as MpClient['request'],
})
const pay = (over: Record<string, unknown> = {}) => ({ id: 777, status: 'approved', status_detail: 'accredited', external_reference: INTENT, transaction_amount: 9000, currency_id: 'ARS', ...over })

describe('pago individual: el estado real lo decide la API, no la notificación', () => {
  it('aprobado según la API: se registra con importe y moneda REALES de MP', async () => {
    const { s, calls } = store()
    const r = await processMpEvent({ mp: mp(pay()), store: s }, { topic: 'payment', dataId: '777' })
    expect(r.outcome).toBe('processed')
    expect(calls.recordPayment[0][0]).toMatchObject({ intentId: INTENT, externalId: '777', mpStatus: 'approved', amount: 9000, currency: 'ARS', subscriptionId: null })
  })
  it.each(['pending', 'in_process', 'authorized'])('pendiente (%s): se registra como tal, jamás como aprobado', async (st) => {
    const { s, calls } = store()
    await processMpEvent({ mp: mp(pay({ status: st })), store: s }, { topic: 'payment', dataId: '777' })
    expect(calls.recordPayment[0][0].mpStatus).toBe(st)
    expect(calls.recordPayment[0][0].mpStatus).not.toBe('approved')
  })
  it.each(['rejected', 'cancelled'])('rechazado/cancelado (%s): se registra tal cual', async (st) => {
    const { s, calls } = store()
    await processMpEvent({ mp: mp(pay({ status: st, status_detail: 'cc_rejected_other_reason' })), store: s }, { topic: 'payment', dataId: '777' })
    expect(calls.recordPayment[0][0].mpStatus).toBe(st)
  })
  it('importe distinto del esperado (la base lo detecta): se rechaza sin reintentos y sin acreditar', async () => {
    const { s } = store({ recordPayment: async () => { throw new Error('mp:amount_mismatch') } })
    const r = await processMpEvent({ mp: mp(pay({ transaction_amount: 1 })), store: s }, { topic: 'payment', dataId: '777' })
    expect(r).toEqual({ outcome: 'rejected', detail: 'mp:amount_mismatch' })
  })
  it('moneda distinta de ARS (la base lo detecta): se rechaza', async () => {
    const { s } = store({ recordPayment: async () => { throw new Error('mp:currency_mismatch') } })
    expect((await processMpEvent({ mp: mp(pay({ currency_id: 'USD' })), store: s }, { topic: 'payment', dataId: '777' })).outcome).toBe('rejected')
  })
  it('pago duplicado (MP reenvía): el resultado «duplicate» de la base se propaga y no hay segundo efecto', async () => {
    const { s } = store({ recordPayment: async () => ({ outcome: 'duplicate' }) })
    expect((await processMpEvent({ mp: mp(pay()), store: s }, { topic: 'payment', dataId: '777' })).outcome).toBe('duplicate')
  })
  it('error al consultar la API de MP (5xx / red): se propaga para reintentar; NO se registra ni aprueba nada', async () => {
    for (const status of [500, 0]) {
      const { s, calls } = store()
      await expect(processMpEvent({ mp: mp(new MpApiError(status, 'x')), store: s }, { topic: 'payment', dataId: '777' })).rejects.toBeInstanceOf(MpApiError)
      expect(calls.recordPayment).toBeUndefined()
    }
  })
  it('pago inexistente en MP (404): ignorado, sin registrar', async () => {
    const { s, calls } = store()
    expect((await processMpEvent({ mp: mp(undefined), store: s }, { topic: 'payment', dataId: '1' })).outcome).toBe('ignored')
    expect(calls.recordPayment).toBeUndefined()
  })
  it('external_reference ajena (no es una operación nuestra): ignorado', async () => {
    const { s, calls } = store()
    expect((await processMpEvent({ mp: mp(pay({ external_reference: 'otro-sistema' })), store: s }, { topic: 'payment', dataId: '777' })).outcome).toBe('ignored')
    expect(calls.recordPayment).toBeUndefined()
  })
  it('merchant_order: no se trata como pago ni se consulta nada (tópico no manejado)', async () => {
    const { s, calls } = store()
    const r = await processMpEvent({ mp: mp(new Error('no debería consultarse')), store: s }, { topic: 'merchant_order', dataId: '555' })
    expect(r.outcome).toBe('ignored'); expect(calls.recordPayment).toBeUndefined()
  })
  it('un pago de un solo cobro nunca crea suscripciones vencidas ni toca preapprovals', async () => {
    const { s, calls } = store()
    await processMpEvent({ mp: mp(pay()), store: s }, { topic: 'payment', dataId: '777' })
    expect(calls.createLapsedSubscription).toBeUndefined(); expect(calls.setPreapprovalStatus).toBeUndefined()
  })
})

describe('receipt-only: solo puede registrar la recepción', () => {
  it('usa únicamente logEvent y finishEvent; guarda outcome received_unverified y nunca el id', async () => {
    const seen: any = { log: [], fin: [], other: [] }
    const proxy = new Proxy({} as any, {
      get: (_t, p: string) => p === 'logEvent' ? async (e: any) => { seen.log.push(e); return 'e1' }
        : p === 'finishEvent' ? async (...a: any[]) => { seen.fin.push(a) }
        : (seen.other.push(String(p)), (() => { throw new Error('prohibido') })()),
    })
    const id = await recordUnverifiedReceipt(proxy, { topic: 'payment', requestId: 'req-1', reason: 'falta_data_id', formato: 'ipn', firmaVerificada: false, idPresente: true })
    expect(id).toBe('e1'); expect(seen.other).toEqual([])
    expect(seen.log[0]).toEqual({ topic: 'payment', dataId: null, requestId: 'req-1' })
    expect(seen.fin[0][1]).toBe(RECEIPT_ONLY_OUTCOME); expect(RECEIPT_ONLY_OUTCOME).toBe('received_unverified')
    expect(seen.fin[0][2]).toContain('firma_verificada=false')
  })
})

describe('diagnóstico de manifest (solo logs; nunca decide)', () => {
  const SECRET = 'sec-sintetico'; const RID = 'rid-1'; const TS = '1700000000'
  const sig = (manifest: string, secret = SECRET) => `ts=${TS},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`
  it('firma sin par id (manifest del SDK): sin_id=true', () => {
    expect(diagnoseManifestVariants({ secret: SECRET, signatureHeader: sig(`request-id:${RID};ts:${TS};`), requestId: RID, ipnId: '99' }))
      .toEqual({ solo_diagnostico: true, sin_id: true, con_id_ipn: false, con_id_ipn_minusculas: null })
  })
  it('firma con el id del IPN: se detecta (el secreto es correcto) pero verifyMpSignature sigue rechazando', () => {
    const header = sig(`id:99;request-id:${RID};ts:${TS};`)
    expect(diagnoseManifestVariants({ secret: SECRET, signatureHeader: header, requestId: RID, ipnId: '99' })?.con_id_ipn).toBe(true)
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: header, requestId: RID, dataId: null })).toBe(false)
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: header, requestId: RID, dataId: null, allowMissingDataId: true })).toBe(false)
  })
  it('secreto equivocado: ninguna variante coincide (señal de secreto/modo incorrecto)', () => {
    const header = sig(`id:99;request-id:${RID};ts:${TS};`, 'otro-secreto')
    expect(diagnoseManifestVariants({ secret: SECRET, signatureHeader: header, requestId: RID, ipnId: '99' }))
      .toMatchObject({ sin_id: false, con_id_ipn: false })
  })
  it('id alfanumérico con mayúsculas: prueba también la variante en minúsculas', () => {
    const header = sig(`id:abc;request-id:${RID};ts:${TS};`)
    expect(diagnoseManifestVariants({ secret: SECRET, signatureHeader: header, requestId: RID, ipnId: 'ABC' })).toMatchObject({ con_id_ipn: false, con_id_ipn_minusculas: true })
  })
  it('cabecera ausente o malformada: null; solo devuelve booleanos (ningún valor sensible)', () => {
    expect(diagnoseManifestVariants({ secret: SECRET, signatureHeader: null, requestId: RID, ipnId: '1' })).toBeNull()
    expect(diagnoseManifestVariants({ secret: SECRET, signatureHeader: 'ts=1,v1=corta', requestId: RID, ipnId: '1' })).toBeNull()
    const d = diagnoseManifestVariants({ secret: SECRET, signatureHeader: sig(`ts:${TS};`), requestId: null, ipnId: null })!
    expect(Object.values(d).every((v) => typeof v === 'boolean' || v === null)).toBe(true)
  })
})

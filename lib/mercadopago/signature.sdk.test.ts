import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { buildMpManifest, verifyMpSignature, describeSignatureRejection } from './signature'
import { WebhookSignatureValidator } from './__reference__/sdk-webhook-validator'

const SECRET = 's', TS = '1761181234567'
const sign = (m: string, secret = SECRET) => `ts=${TS},v1=${createHmac('sha256', secret).update(m).digest('hex')}`
const sdk = (h: string, rid: string | null, id: string | null) => { try { WebhookSignatureValidator.validate({ xSignature: h, xRequestId: rid, dataId: id, secret: SECRET }); return true } catch { return false } }

describe('buildMpManifest = manifest del SDK oficial', () => {
  it.each([
    ['123', 'r', 'id:123;request-id:r;ts:1;'], [null, 'r', 'request-id:r;ts:1;'], ['123', null, 'id:123;ts:1;'], [null, null, 'ts:1;'], ['', '', 'ts:1;'],
  ])('id=%s request-id=%s → %s', (id, rid, esperado) => expect(buildMpManifest(id, rid, '1')).toBe(esperado))
})

describe('verifyMpSignature sin data.id', () => {
  const h = sign(buildMpManifest(null, 'r', TS))
  it('por defecto sigue rechazando (comportamiento de siempre)', () => expect(verifyMpSignature({ secret: SECRET, signatureHeader: h, requestId: 'r', dataId: null })).toBe(false))
  it('con allowMissingDataId valida con el manifest sin id, igual que el SDK', () => {
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: h, requestId: 'r', dataId: null, allowMissingDataId: true })).toBe(true)
    expect(sdk(h, 'r', null)).toBe(true)
  })
  it('con allowMissingDataId sigue exigiendo x-request-id, x-signature válida y el secreto correcto', () => {
    const ok = { secret: SECRET, signatureHeader: h, requestId: 'r', dataId: null, allowMissingDataId: true }
    expect(verifyMpSignature({ ...ok, requestId: null })).toBe(false)
    expect(verifyMpSignature({ ...ok, requestId: 'otro' })).toBe(false)
    expect(verifyMpSignature({ ...ok, signatureHeader: null })).toBe(false)
    expect(verifyMpSignature({ ...ok, signatureHeader: 'ts=1,v1=corta' })).toBe(false)
    expect(verifyMpSignature({ ...ok, secret: 'otro' })).toBe(false)
    expect(verifyMpSignature({ ...ok, secret: '' })).toBe(false)
  })
  it('una firma calculada CON id no vale cuando no hay data.id (no se inventa uno)', () => {
    const conId = sign(buildMpManifest('999', 'r', TS))
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: conId, requestId: 'r', dataId: null, allowMissingDataId: true })).toBe(false)
  })
  it('describeSignatureRejection: sin permiso → falta_data_id; con permiso → firma_no_coincide', () => {
    const o = { secret: SECRET, signatureHeader: sign('x'), requestId: 'r', dataId: null }
    expect(describeSignatureRejection(o).categoria).toBe('falta_data_id')
    expect(describeSignatureRejection({ ...o, allowMissingDataId: true }).categoria).toBe('firma_no_coincide')
  })
})

describe('con data.id presente: mismas decisiones que el SDK (ids numéricos y hex en minúsculas)', () => {
  it.each(['123456789', '2c938084726fca48'])('id %s', (id) => {
    const h = sign(buildMpManifest(id, 'r', TS))
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: h, requestId: 'r', dataId: id })).toBe(sdk(h, 'r', id))
    const bad = sign(buildMpManifest(id, 'r', TS), 'x')
    expect(verifyMpSignature({ secret: SECRET, signatureHeader: bad, requestId: 'r', dataId: id })).toBe(sdk(bad, 'r', id))
  })
})

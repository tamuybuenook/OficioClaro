import { describe, it, expect } from 'vitest'
import { checkAlias, checkCbu, checkCuit, checkHolder, parseBankForm, paymentConfigFromRows, bankFieldsFromRows, transferFromBank } from './payment-config'

const fd = (o: Record<string, string>) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.set(k, v)); return f }
const OK = { holder: 'OficioClaro SAS', cuit: '30-71234567-8', cbu: '0000003100012345678901', alias: 'oficio.claro' }

describe('CBU/CVU: exactamente 22 dígitos', () => {
  it('acepta 22 dígitos (con espacios o guiones los limpia)', () => {
    expect(checkCbu('0000003100012345678901')).toEqual({ ok: true, value: '0000003100012345678901' })
    expect(checkCbu('00000031 00012345 678901')).toEqual({ ok: true, value: '0000003100012345678901' })
  })
  it('rechaza 21, 23, letras, vacío', () => {
    for (const v of ['000000310001234567890', '00000031000123456789012', '000000310001234567890A', '', '   ']) expect(checkCbu(v).ok).toBe(false)
  })
})

describe('CUIT/CUIL: obligatorio, 11 dígitos', () => {
  it('normaliza a XX-XXXXXXXX-X', () => {
    expect(checkCuit('30712345678')).toEqual({ ok: true, value: '30-71234567-8' })
    expect(checkCuit('30-71234567-8')).toEqual({ ok: true, value: '30-71234567-8' })
  })
  it('rechaza vacío, corto, largo y letras', () => {
    for (const v of ['', '3071234567', '307123456789', '30-7123456A-8']) expect(checkCuit(v).ok).toBe(false)
  })
})

describe('Alias opcional y titular', () => {
  it('alias vacío = null; válido pasa; inválido no', () => {
    expect(checkAlias('')).toEqual({ ok: true, value: null })
    expect(checkAlias(' oficio.claro ')).toEqual({ ok: true, value: 'oficio.claro' })
    for (const v of ['corto', 'tiene espacios aca', 'a'.repeat(21), 'ñandú.alias']) expect(checkAlias(v).ok).toBe(false)
  })
  it('titular: obligatorio, sin caracteres de control', () => {
    expect(checkHolder('  Ana   Pérez ')).toEqual({ ok: true, value: 'Ana Pérez' })
    for (const v of ['', ' ', 'A', 'x\u0000y', 'a'.repeat(121)]) expect(checkHolder(v).ok).toBe(false)
  })
})

describe('parseBankForm', () => {
  it('formulario completo OK; alias puede faltar', () => {
    expect(parseBankForm(fd(OK))).toEqual({ ok: true, value: OK })
    expect(parseBankForm(fd({ ...OK, alias: '' }))).toEqual({ ok: true, value: { ...OK, alias: null } })
  })
  it('falta titular, CUIT o CBU => error y no pasa', () => {
    for (const k of ['holder', 'cuit', 'cbu'] as const) expect(parseBankForm(fd({ ...OK, [k]: '' })).ok).toBe(false)
    expect(parseBankForm(new FormData()).ok).toBe(false)
  })
})

describe('lectura tolerante de app_settings', () => {
  const rows = [
    { key: 'notice_days', value: 5, text_value: null },
    { key: 'mp_hidden', value: 0, text_value: null },
    { key: 'bank_holder', value: 0, text_value: OK.holder }, { key: 'bank_cuit', value: 0, text_value: OK.cuit },
    { key: 'bank_cbu', value: 0, text_value: OK.cbu }, { key: 'bank_alias', value: 0, text_value: OK.alias },
  ]
  it('config completa => banco y MP visible', () => {
    expect(paymentConfigFromRows(rows)).toEqual({ bank: OK, mpHidden: false })
    expect(bankFieldsFromRows(rows)).toEqual(OK)
  })
  it('mp_hidden = 1 => oculto; cualquier otro valor => visible', () => {
    expect(paymentConfigFromRows([{ key: 'mp_hidden', value: 1 }]).mpHidden).toBe(true)
    expect(paymentConfigFromRows([{ key: 'mp_hidden', value: 2 }]).mpHidden).toBe(false)
  })
  it('sin filas, nulas, basura o datos incompletos/inválidos => sin banco (nunca rompe)', () => {
    for (const r of [null, undefined, 'x', [], [null, 3, {}], rows.filter((x) => x.key !== 'bank_cbu'), rows.map((x) => x.key === 'bank_cbu' ? { ...x, text_value: '123' } : x)]) {
      expect(paymentConfigFromRows(r).bank).toBeNull()
    }
    expect(paymentConfigFromRows(null).mpHidden).toBe(false)
  })
  it('alias sin cargar no impide mostrar los datos', () => {
    expect(paymentConfigFromRows(rows.map((x) => x.key === 'bank_alias' ? { ...x, text_value: null } : x)).bank).toEqual({ ...OK, alias: null })
  })
})

describe('transferFromBank', () => {
  it('arma lo que ve el cliente', () => {
    expect(transferFromBank(OK)).toEqual({ bank: null, alias: OK.alias, cbu: OK.cbu, holder: OK.holder, holderCuit: OK.cuit, note: null })
  })
})

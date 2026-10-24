import { describe, it, expect } from 'vitest'
import { lineSubtotal, quoteTotal, validateLine, validateQuote, hasErrors, parseDecimal, toPayload, MAX_LINES, type QuoteLine } from './quotes'

const line = (o: Partial<QuoteLine> = {}): QuoteLine => ({ key: 'a', source: 'custom', serviceId: null, catalogItemId: null, description: 'Flete', unitLabel: null, quantity: 1, unitPrice: 100, ...o })

describe('cálculo de líneas y total (misma regla que save_quote en la base)', () => {
  it('redondea precio y cantidad a 2 decimales y luego multiplica (vector de la prueba SQL: 3 × 1,005 = 3,03)', () => {
    expect(lineSubtotal(3, 1.005)).toBe(3.03)
    expect(quoteTotal([{ quantity: 2, unitPrice: 1000 }, { quantity: 1, unitPrice: 2000 }, { quantity: 3, unitPrice: 1.005 }])).toBe(4003.03)
  })
  it('no sufre errores de coma flotante', () => {
    expect(lineSubtotal(1, 0.1) + lineSubtotal(1, 0.2)).toBeCloseTo(0.3, 10)
    expect(quoteTotal([{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }])).toBe(0.3)
  })
  it('nunca lanza con valores incompletos o enormes mientras se escribe', () => {
    expect(lineSubtotal(NaN, 10)).toBe(0)
    expect(lineSubtotal(2, NaN)).toBe(0)
    expect(lineSubtotal(Infinity, 1)).toBe(0)
    expect(lineSubtotal(1e23, 1)).toBe(0)
    expect(lineSubtotal(1, 1e23)).toBe(0)
    expect(lineSubtotal(-1, 5)).toBe(0)
    expect(quoteTotal([{ quantity: NaN, unitPrice: 1 }, { quantity: 2, unitPrice: 5 }])).toBe(10)
  })
})

describe('validación', () => {
  it('línea válida', () => expect(validateLine(line())).toEqual({}))
  it('descripción vacía o larga', () => {
    expect(validateLine(line({ description: '  ' })).description).toBeTruthy()
    expect(validateLine(line({ description: 'x'.repeat(201) })).description).toBeTruthy()
  })
  it('cantidad: 0, negativa, NaN o enorme', () => {
    for (const q of [0, -1, NaN, 0.001]) expect(validateLine(line({ quantity: q })).quantity).toBeTruthy()
    expect(validateLine(line({ quantity: 1e9 })).quantity).toBeTruthy()
    expect(validateLine(line({ quantity: 0.01 })).quantity).toBeUndefined()
  })
  it('precio: negativo, NaN o enorme; 0 es válido (concepto sin cargo)', () => {
    for (const p of [-1, NaN, 1e11]) expect(validateLine(line({ unitPrice: p })).unitPrice).toBeTruthy()
    expect(validateLine(line({ unitPrice: 0 })).unitPrice).toBeUndefined()
  })
  it('límite de líneas y de observaciones', () => {
    const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => line({ key: String(i) }))
    expect(hasErrors(validateQuote(many, ''))).toBe(true)
    expect(hasErrors(validateQuote([line()], 'x'.repeat(1001)))).toBe(true)
    expect(hasErrors(validateQuote([line()], 'ok'))).toBe(false)
  })
  it('el pedido al servidor no incluye propiedad ni totales', () => {
    const p = toPayload([line({ description: '  Flete  ', quantity: 1.239, unitPrice: 10.005 })])
    expect(p[0]).toEqual({ service_id: null, catalog_item_id: null, description: 'Flete', quantity: 1.24, unit_price: 10.01, unit_label: null })
    expect(JSON.stringify(p)).not.toMatch(/user|total|subtotal/)
  })
})

describe('parseDecimal', () => {
  it.each([['1234', 1234], ['1234,5', 1234.5], ['1.234,50', 1234.5], ['1234.5', 1234.5], ['  12 ', 12], ['0', 0]])('%s → %s', (raw, n) => expect(parseDecimal(raw)).toBe(n))
  it.each(['', 'abc', '1,2,3', '12a', '-', '1e5'])('"%s" no es un número', (raw) => expect(parseDecimal(raw)).toBeNaN())
})

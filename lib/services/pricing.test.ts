import { describe, it, expect } from 'vitest'
import { calculateUtPrice, resolvePersonalPrice } from './pricing'

describe('calculateUtPrice', () => {
  it('coeficiente × valor UT (sección 12)', () => {
    expect(calculateUtPrice(3.5, 10000)).toBe(35000)
  })
})

describe('resolvePersonalPrice', () => {
  it('prioriza el precio personalizado explícito', () => {
    const result = resolvePersonalPrice({ customPrice: 60000, utCoefficient: 3.5, unitValue: 10000, referencePrice: 55000 })
    expect(result).toEqual({ price: 60000, source: 'custom' })
  })
  it('sin precio explícito, usa la UT propia de esa tarea si el usuario la cargó', () => {
    const result = resolvePersonalPrice({ customPrice: null, customUtCoefficient: 3.0, utCoefficient: 2.5, unitValue: 10000, referencePrice: 38500 })
    expect(result).toEqual({ price: 30000, source: 'custom-ut' })
  })
  it('sin personalizado, usa UT si el servicio tiene coeficiente', () => {
    const result = resolvePersonalPrice({ customPrice: null, utCoefficient: 2.5, unitValue: 10000, referencePrice: 38500 })
    expect(result).toEqual({ price: 25000, source: 'ut' })
  })
  it('sin personalizado ni UT, cae al precio de referencia', () => {
    const result = resolvePersonalPrice({ customPrice: null, utCoefficient: null, unitValue: null, referencePrice: 38500 })
    expect(result).toEqual({ price: 38500, source: 'reference' })
  })
  it('no usa UT si no hay valor de UT cargado', () => {
    const result = resolvePersonalPrice({ customPrice: null, utCoefficient: 2.5, unitValue: null, referencePrice: 38500 })
    expect(result).toEqual({ price: 38500, source: 'reference' })
  })
})

describe('circuitos independientes (UT maestra vs UT personal)', () => {
  it('el precio personal usa la UT del usuario, no la maestra', () => {
    const maestra = calculateUtPrice(3.4, 39000)
    const u1 = resolvePersonalPrice({ customPrice: null, utCoefficient: 3.4, unitValue: 50000, referencePrice: maestra })
    const u2 = resolvePersonalPrice({ customPrice: null, utCoefficient: 3.4, unitValue: 60000, referencePrice: maestra })
    expect(maestra).toBe(132600)
    expect(u1).toEqual({ price: 170000, source: 'ut' })
    expect(u2).toEqual({ price: 204000, source: 'ut' })
  })
  it('un precio manual (custom_price) no se recalcula con la UT', () => {
    const r = resolvePersonalPrice({ customPrice: 99999, utCoefficient: 3.4, unitValue: 50000, referencePrice: 132600 })
    expect(r).toEqual({ price: 99999, source: 'custom' })
  })
  it('redondeo idéntico a la base (medio centavo)', () => {
    expect(calculateUtPrice(0.001, 5.5)).toBe(0.01)
  })
})

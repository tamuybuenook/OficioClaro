import { describe, it, expect } from 'vitest'
import { cleanCatalogInput, DEFAULT_UNIT } from './catalogItems'

const ok = { name: '  Flete  ', description: ' Hasta 20 km ', category: ' Logística ', unit_label: ' viaje ', price: '1.500,5' }

describe('catálogo propio: validación', () => {
  it('normaliza espacios y parsea el precio con formato argentino', () => {
    expect(cleanCatalogInput(ok).value).toEqual({ name: 'Flete', description: 'Hasta 20 km', category: 'Logística', unit_label: 'viaje', unit_price: 1500.5 })
  })
  it('descripción y categoría vacías pasan a null; unidad vacía usa la predeterminada', () => {
    expect(cleanCatalogInput({ ...ok, description: ' ', category: '', unit_label: '' }).value).toMatchObject({ description: null, category: null, unit_label: DEFAULT_UNIT })
  })
  it('errores por campo', () => {
    const e = cleanCatalogInput({ name: '', description: 'x'.repeat(501), category: 'c'.repeat(61), unit_label: 'u'.repeat(21), price: '-5' }).errors!
    expect(Object.keys(e).sort()).toEqual(['category', 'description', 'name', 'price', 'unit_label'])
  })
  it('precio inválido o gigante', () => {
    expect(cleanCatalogInput({ ...ok, price: 'abc' }).errors?.price).toBeTruthy()
    expect(cleanCatalogInput({ ...ok, price: '99999999999' }).errors?.price).toBeTruthy()
    expect(cleanCatalogInput({ ...ok, price: '0' }).value?.unit_price).toBe(0)
  })
  it('nunca incluye user_id', () => expect(Object.keys(cleanCatalogInput(ok).value!)).not.toContain('user_id'))
})

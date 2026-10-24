// Validación del catálogo propio (pura). La base repite estas reglas con CHECK; esto da mensajes claros.
import { round2 } from '@/lib/money'
import { MAX_PRICE, parseDecimal } from '@/lib/quotes'

export const CATALOG = { name: 120, description: 500, category: 60, unit: 20 } as const
export const DEFAULT_UNIT = 'Unidad'
export const UNIT_PRESETS = ['Unidad', 'Trabajo', 'Hora', 'Día', 'm', 'm²', 'm³', 'kg', 'Global'] as const

export type CatalogItemInput = { name: string; description: string; category: string; unit_label: string; price: string }
export type CatalogItemClean = { name: string; description: string | null; category: string | null; unit_label: string; unit_price: number }
export type CatalogFieldErrors = Partial<Record<keyof CatalogItemInput, string>>

export function cleanCatalogInput(input: CatalogItemInput): { value?: CatalogItemClean; errors?: CatalogFieldErrors } {
  const errors: CatalogFieldErrors = {}
  const name = input.name.trim()
  const description = input.description.trim()
  const category = input.category.trim()
  const unit = input.unit_label.trim() || DEFAULT_UNIT
  const price = parseDecimal(input.price)

  if (!name) errors.name = 'Escribí el nombre.'
  else if (name.length > CATALOG.name) errors.name = `Máximo ${CATALOG.name} caracteres.`
  if (description.length > CATALOG.description) errors.description = `Máximo ${CATALOG.description} caracteres.`
  if (category.length > CATALOG.category) errors.category = `Máximo ${CATALOG.category} caracteres.`
  if (unit.length > CATALOG.unit) errors.unit_label = `Máximo ${CATALOG.unit} caracteres.`
  if (!Number.isFinite(price)) errors.price = 'Ingresá un precio válido (ej.: 12500 o 12.500,50).'
  else if (price < 0) errors.price = 'El precio no puede ser negativo.'
  else if (price > MAX_PRICE) errors.price = 'El precio es demasiado grande.'

  if (Object.keys(errors).length) return { errors }
  return { value: { name, description: description || null, category: category || null, unit_label: unit, unit_price: round2(price) } }
}

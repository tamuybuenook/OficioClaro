// Reglas puras de presupuestos (sin base de datos). Las usan el formulario (vista previa) y las acciones.
// La base de datos (save_quote, migración 0035) recalcula todo con la MISMA regla y es la que decide.
import { mulRound2, round2 } from '@/lib/money'

export const MAX_LINES = 200
export const MAX_DESCRIPTION = 200
export const MAX_NOTES = 1000
export const MAX_QUANTITY = 99_999_999
export const MAX_PRICE = 9_999_999_999.99

export type LineSource = 'service' | 'own' | 'custom'

/** Una línea del formulario. `key` solo identifica la fila en pantalla. */
export type QuoteLine = {
  key: string
  source: LineSource
  serviceId: string | null
  catalogItemId: string | null
  description: string
  unitLabel: string | null
  quantity: number
  unitPrice: number
}

/** Lo que viaja al servidor (nunca incluye user_id ni totales: los calcula la base). */
export type QuoteLinePayload = {
  service_id: string | null
  catalog_item_id: string | null
  description: string
  quantity: number
  unit_price: number
  unit_label: string | null
}

// Igual que save_quote(): cantidad y precio se redondean a 2 decimales y luego se multiplican.
// Vista previa tolerante: mientras el usuario escribe, un valor vacío/ inválido/ fuera de rango cuenta como 0
// (la validación lo marca al guardar); nunca debe lanzar una excepción y romper la pantalla.
const usable = (n: number, max: number) => Number.isFinite(n) && n >= 0 && n <= max
export function lineSubtotal(quantity: number, unitPrice: number): number {
  if (!usable(quantity, MAX_QUANTITY) || !usable(unitPrice, MAX_PRICE)) return 0
  return mulRound2(round2(quantity), round2(unitPrice))
}

export function quoteTotal(lines: Pick<QuoteLine, 'quantity' | 'unitPrice'>[]): number {
  return round2(lines.reduce((sum, l) => sum + lineSubtotal(l.quantity, l.unitPrice), 0))
}

export type LineErrors = { description?: string; quantity?: string; unitPrice?: string }

/** Errores por línea, para mostrarlos junto al campo. Devuelve {} si la línea es válida. */
export function validateLine(l: Pick<QuoteLine, 'description' | 'quantity' | 'unitPrice'>): LineErrors {
  const e: LineErrors = {}
  const d = l.description.trim()
  if (!d) e.description = 'Escribí una descripción.'
  else if (d.length > MAX_DESCRIPTION) e.description = `Máximo ${MAX_DESCRIPTION} caracteres.`
  if (!Number.isFinite(l.quantity) || l.quantity < 0.005) e.quantity = 'La cantidad debe ser mayor que 0.'
  else if (l.quantity > MAX_QUANTITY) e.quantity = 'La cantidad es demasiado grande.'
  if (!Number.isFinite(l.unitPrice) || l.unitPrice < 0) e.unitPrice = 'El precio no puede ser negativo.'
  else if (l.unitPrice > MAX_PRICE) e.unitPrice = 'El precio es demasiado grande.'
  return e
}

export function validateQuote(lines: QuoteLine[], notes: string): { lines: Record<string, LineErrors>; form?: string } {
  const out: { lines: Record<string, LineErrors>; form?: string } = { lines: {} }
  if (lines.length > MAX_LINES) out.form = `Un presupuesto admite hasta ${MAX_LINES} líneas.`
  if (notes.length > MAX_NOTES) out.form = `Las observaciones admiten hasta ${MAX_NOTES} caracteres.`
  for (const l of lines) {
    const e = validateLine(l)
    if (Object.keys(e).length) out.lines[l.key] = e
  }
  return out
}

export const hasErrors = (v: ReturnType<typeof validateQuote>) => !!v.form || Object.keys(v.lines).length > 0

export function toPayload(lines: QuoteLine[]): QuoteLinePayload[] {
  return lines.map((l) => ({
    service_id: l.serviceId,
    catalog_item_id: l.catalogItemId,
    description: l.description.trim(),
    quantity: round2(l.quantity),
    unit_price: round2(l.unitPrice),
    unit_label: l.unitLabel,
  }))
}

/** Acepta "1.234,50", "1234.5" o "1234,5". Devuelve NaN si no es un número. */
export function parseDecimal(raw: string): number {
  const s = raw.trim().replace(/\s/g, '')
  if (!s) return NaN
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN
}

export function quoteNumberLabel(n: number | null | undefined): string {
  return `Nº ${String(n ?? '?').padStart(5, '0')}`
}

// ---- Tipos compartidos entre acciones del servidor y pantallas ----
export type CustomerOption = { id: string; name: string; phone: string | null; address: string | null }

/** Un concepto que se puede agregar a un presupuesto (viene de la lista de OficioClaro o del catálogo propio). */
export type Concept = {
  kind: 'service' | 'own'
  id: string
  name: string
  description: string | null
  category: string | null
  unit: string
  price: number
}
export type ConceptPage = { items: Concept[]; total: number; page: number; pageSize: number }

export type OwnCatalogItem = {
  id: string; name: string; description: string | null; category: string | null
  unit_label: string; unit_price: number; is_active: boolean; updated_at: string
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected'
export const QUOTE_STATUS_LABEL: Record<string, string> = { draft: 'Borrador', sent: 'Enviado', accepted: 'Aceptado', rejected: 'Rechazado' }

export type QuoteForEdit = {
  id: string; number: number | null; status: QuoteStatus; notes: string | null; total: number; created_at: string
  customer: CustomerOption | null
  lines: QuoteLine[]
  job: { id: string; description: string; status: string } | null
}

export type SaveQuoteResult =
  | { data: { id: string; number: number; total: number; created: boolean; linked: boolean; linkError?: string }; error?: undefined; fieldErrors?: undefined }
  | { error: string; fieldErrors?: Record<string, LineErrors>; data?: undefined }

/** Escapa comodines de LIKE y caracteres que rompen filtros de PostgREST. */
export const likeEscape = (w: string) => w.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()"]/g, ' ')
export const searchWords = (q: string) => q.trim().split(/\s+/).filter(Boolean).slice(0, 6)

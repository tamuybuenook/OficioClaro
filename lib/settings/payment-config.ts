// Configuración de cobro editable por el admin (tabla app_settings, migración 0036):
// datos bancarios para transferencias y el interruptor que oculta la sección de Mercado Pago.
// Lectura tolerante (nunca rompe la pantalla) y validación estricta de lo que escribe el admin.
import type { TransferInstructions } from '@/lib/transfer-instructions'

export const PAYMENT_CONFIG_KEYS = ['mp_hidden', 'bank_holder', 'bank_cuit', 'bank_cbu', 'bank_alias'] as const

export type BankDetails = { holder: string; cuit: string; cbu: string; alias: string | null }
export type PaymentConfig = { bank: BankDetails | null; mpHidden: boolean }
export type BankFields = { holder: string; cuit: string; cbu: string; alias: string }

export const MIGRATION_MISSING_MSG = 'Falta aplicar la migración 0036 en la base de datos. Hasta entonces no se puede guardar esta configuración.'

const CONTROL = /[\u0000-\u001f\u007f]/

type Check<T> = { ok: true; value: T } | { ok: false; error: string }

export function checkHolder(raw: string): Check<string> {
  const s = raw.trim()
  if (CONTROL.test(s)) return { ok: false, error: 'El nombre del titular tiene caracteres no permitidos.' }
  const v = s.replace(/\s+/g, ' ')
  if (v.length < 2 || v.length > 120) return { ok: false, error: 'Ingresá el nombre del titular (entre 2 y 120 caracteres).' }
  return { ok: true, value: v }
}

/** CUIT/CUIL: 11 dígitos, con o sin guiones/espacios. Se guarda como XX-XXXXXXXX-X. */
export function checkCuit(raw: string): Check<string> {
  const d = raw.replace(/[\s-]/g, '')
  if (!/^\d{11}$/.test(d)) return { ok: false, error: 'El CUIT/CUIL es obligatorio y debe tener 11 dígitos.' }
  return { ok: true, value: `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` }
}

/** CBU/CVU: exactamente 22 dígitos (se aceptan espacios o guiones al tipearlo). */
export function checkCbu(raw: string): Check<string> {
  const d = raw.replace(/[\s-]/g, '')
  if (!/^\d{22}$/.test(d)) return { ok: false, error: 'El CBU/CVU es obligatorio y debe tener exactamente 22 dígitos.' }
  return { ok: true, value: d }
}

/** Alias opcional: vacío = sin alias. Si se carga: 6 a 20 caracteres (letras, números, punto y guion). */
export function checkAlias(raw: string): Check<string | null> {
  const s = raw.trim()
  if (!s) return { ok: true, value: null }
  if (!/^[A-Za-z0-9.-]{6,20}$/.test(s)) return { ok: false, error: 'El alias debe tener entre 6 y 20 caracteres: letras, números, punto o guion.' }
  return { ok: true, value: s }
}

export function parseBankForm(formData: FormData): Check<BankDetails> {
  const get = (k: string) => { const v = formData.get(k); return typeof v === 'string' ? v : '' }
  const holder = checkHolder(get('holder')); if (!holder.ok) return holder
  const cuit = checkCuit(get('cuit')); if (!cuit.ok) return cuit
  const cbu = checkCbu(get('cbu')); if (!cbu.ok) return cbu
  const alias = checkAlias(get('alias')); if (!alias.ok) return alias
  return { ok: true, value: { holder: holder.value, cuit: cuit.value, cbu: cbu.value, alias: alias.value } }
}

type Row = { key?: unknown; value?: unknown; text_value?: unknown }
const rowsOf = (rows: unknown): Row[] => (Array.isArray(rows) ? (rows as Row[]).filter((r) => r && typeof r === 'object') : [])
const textOf = (list: Row[], key: string): string => { const v = list.find((r) => r.key === key)?.text_value; return typeof v === 'string' ? v : '' }

/** Texto crudo guardado (para precargar el formulario). */
export function bankFieldsFromRows(rows: unknown): BankFields {
  const l = rowsOf(rows)
  return { holder: textOf(l, 'bank_holder'), cuit: textOf(l, 'bank_cuit'), cbu: textOf(l, 'bank_cbu'), alias: textOf(l, 'bank_alias') }
}

/** Filas de app_settings -> configuración. Filas ausentes, ilegibles o inválidas => sin datos bancarios y MP visible. */
export function paymentConfigFromRows(rows: unknown): PaymentConfig {
  const l = rowsOf(rows)
  const f = bankFieldsFromRows(rows)
  const holder = checkHolder(f.holder); const cuit = checkCuit(f.cuit); const cbu = checkCbu(f.cbu); const alias = checkAlias(f.alias)
  const bank = holder.ok && cuit.ok && cbu.ok && alias.ok ? { holder: holder.value, cuit: cuit.value, cbu: cbu.value, alias: alias.value } : null
  return { bank, mpHidden: l.find((r) => r.key === 'mp_hidden')?.value === 1 }
}

/** Datos que ve el cliente al elegir transferencia, a partir de los cargados por el admin. */
export function transferFromBank(b: BankDetails): TransferInstructions {
  return { bank: null, alias: b.alias, cbu: b.cbu, holder: b.holder, holderCuit: b.cuit, note: null }
}

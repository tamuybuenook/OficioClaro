/** Acepta "1.234,50", "1234.5" o "1234,5". Devuelve NaN si no es un número. */
export function parseDecimal(raw: string): number {
  const s = raw.trim().replace(/\s/g, '')
  if (!s) return NaN
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN
}

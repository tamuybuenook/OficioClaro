// Aritmética decimal exacta para precios. Misma regla que PostgreSQL: round(a * b, 2),
// "half away from zero". Evita los errores de punto flotante de Math.round(n * 100) / 100
// (p. ej. round2(1.005) daba 1,00 en vez de 1,01).

const DIGITS = 6 // los coeficientes (3 decimales) y valores (2 decimales) caben holgadamente

// número/cadena -> entero escalado por 10^6
function toScaled(value: number | string): bigint {
  const str = (typeof value === 'number' ? value.toFixed(DIGITS) : value).trim()
  const neg = str.startsWith('-')
  const [intPart, fracRaw = ''] = str.replace('-', '').split('.')
  const frac = (fracRaw + '0'.repeat(DIGITS)).slice(0, DIGITS)
  const big = BigInt((intPart || '0') + frac)
  return neg ? -big : big
}

// a × b redondeado a 2 decimales
export function mulRound2(a: number | string, b: number | string): number {
  const product = toScaled(a) * toScaled(b) // escala 10^12
  const neg = product < 0n
  const abs = neg ? -product : product
  const unit = 10n ** 10n // 10^12 -> centésimas
  let cents = abs / unit
  if (abs % unit >= unit / 2n) cents += 1n
  const result = Number(cents) / 100
  return neg ? -result : result
}

export function round2(n: number): number {
  return mulRound2(n, 1)
}

// precio × (1 + porcentaje/100) redondeado a 2 decimales (regla del IPC)
export function applyPercent(price: number, percent: number): number {
  return mulRound2(price, (100 + percent) / 100)
}

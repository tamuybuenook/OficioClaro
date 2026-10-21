// Formatos es-AR para el panel de facturación. Fechas siempre en hora de Argentina.
const TZ = 'America/Argentina/Buenos_Aires'

const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 })
export const formatArs = (n: number | null | undefined) => (n == null || Number.isNaN(Number(n)) ? '—' : ars.format(Number(n)))

const dateFmt = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export function formatDateAr(iso: string | null | undefined): string {
  if (!iso) return '—'
  // 'YYYY-MM-DD' (columnas date) se muestra tal cual, sin pasar por zona horaria.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? '—' : dateFmt.format(t)
}

export function formatDateTimeAr(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? '—' : dateTimeFmt.format(t)
}

/** 'YYYY-MM-DD' de hoy en Argentina. */
export function todayAr(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
}

/** Inicio (inclusive) de un día argentino como instante UTC ISO (Argentina es UTC-3 todo el año, sin horario de verano). */
export const arDayStartIso = (ymd: string) => new Date(`${ymd}T00:00:00-03:00`).toISOString()
/** Fin (exclusivo) = inicio del día siguiente. */
export function arNextDayStartIso(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00-03:00`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

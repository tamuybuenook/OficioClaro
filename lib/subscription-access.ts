// Regla única de acceso por suscripción (la usan servidor y UI). Fecha en formato YYYY-MM-DD.
// Tiene acceso quien está en prueba/activo/vencido-con-período-pagado/cancelado-sin-renovar
// mientras end_date no haya pasado. 'suspended' (decisión de admin) corta el acceso de inmediato.
export type SubStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'

export function todayAR(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(now)
}

export function hasAccess(sub: { status: string; end_date: string | null } | null | undefined, today = todayAR()): boolean {
  if (!sub) return false
  if (!['trial', 'active', 'past_due', 'cancelled'].includes(sub.status)) return false
  if (!sub.end_date) return sub.status === 'active' // histórico: activa sin vencimiento cargado
  return sub.end_date >= today
}

export type DisplayState = 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'suspended' | 'none'

export function displayState(sub: { status: string; end_date: string | null } | null | undefined, today = todayAR()): DisplayState {
  if (!sub) return 'none'
  if (sub.status === 'suspended') return 'suspended'
  if (!hasAccess(sub, today)) return 'expired'
  return sub.status as DisplayState
}

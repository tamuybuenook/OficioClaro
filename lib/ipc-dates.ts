// Regla de negocio (Bloque 0, sección 9): el IPC publicado en un mes se aplica a la lista
// del mes SIGUIENTE a la fecha real de publicación. Módulo puro: lo usan servidor y cliente
// (antes la regla estaba duplicada en ipc-panel.tsx).
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function monthName(index0: number): string {
  return MESES[index0][0].toUpperCase() + MESES[index0].slice(1)
}

export function targetEffectiveDate(publishedDate: string): { date: string; label: string } {
  const [y, m] = publishedDate.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) throw new Error(`Fecha de publicación inválida: ${publishedDate}`)
  const base = new Date(Date.UTC(y, m - 1, 1))
  base.setUTCMonth(base.getUTCMonth() + 1)
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth()
  return { date: `${year}-${String(month + 1).padStart(2, '0')}-01`, label: `${monthName(month)} ${year}` }
}

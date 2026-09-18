import { createClient } from '@/lib/supabase/server'

export async function getIpcIndexes() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('ipc_indexes').select('*').order('year', { ascending: false }).order('month', { ascending: false })
  if (error) throw error
  return data
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Regla de negocio correcta (Bloque 0, sección 9): IPC publicado en un mes
// se aplica a la lista del mes SIGUIENTE, tomando como referencia la fecha
// real de publicación (no "mes del IPC + 2" de forma rígida).
export function targetEffectiveDate(publishedDate: string): { date: string; label: string } {
  const [y, m] = publishedDate.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, 1))
  base.setUTCMonth(base.getUTCMonth() + 1)
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth() // 0-indexed
  const date = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const label = `${MESES[month][0].toUpperCase()}${MESES[month].slice(1)} ${year}`
  return { date, label }
}

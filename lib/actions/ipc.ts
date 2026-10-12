'use server'

import { revalidatePath } from 'next/cache'
import { getAdminContext, cleanDbError } from '@/lib/auth/assert-admin'
import { targetEffectiveDate } from '@/lib/ipc-dates'

export type IpcApplyResult = {
  versions: string[]
  created: { trade: string; version_id: string; base_version_id: string; items: number }[]
  skipped: { trade: string; reason: string }[]
}

export async function createIpcIndex(formData: FormData) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const year = Number(formData.get('year'))
  const month = Number(formData.get('month'))
  const value = Number(String(formData.get('value')).replace(',', '.'))
  const published_date = String(formData.get('published_date'))

  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: 'Año inválido.' }
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: 'Mes inválido.' }
  if (!Number.isFinite(value) || value <= -100 || value >= 1000) return { error: 'El IPC debe ser un porcentaje válido (ej: 4,2).' }
  try { targetEffectiveDate(published_date) } catch { return { error: 'Fecha de publicación inválida.' } }

  const { data, error } = await ctx.supabase
    .from('ipc_indexes').insert({ year, month, value, published_date, status: 'pending' }).select().single()
  if (error) {
    return { error: error.code === '23505' ? `Ya existe un IPC cargado para ${month}/${year}.` : cleanDbError(error.message) }
  }
  await ctx.supabase.from('audit_logs').insert({ actor_id: ctx.user.id, entity: 'ipc_indexes', entity_id: data.id, action: 'create', new_value: data })
  revalidatePath('/admin/ipc')
  return { data }
}

// Genera, por oficio, una versión BORRADOR = precios de la última versión publicada anterior × (1 + IPC/100).
// Atómico (función SQL): si no se genera ninguna versión, el IPC sigue pendiente. Informa listas omitidas y por qué.
export async function applyIpcToAllPriceLists(ipcId: string) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }

  const { data: ipc, error: ipcError } = await ctx.supabase.from('ipc_indexes').select('published_date, status').eq('id', ipcId).single()
  if (ipcError || !ipc) return { error: ipcError ? cleanDbError(ipcError.message) : 'IPC no encontrado' }
  if (ipc.status === 'applied') return { error: 'Este IPC ya fue aplicado.' }

  const { date, label } = targetEffectiveDate(ipc.published_date)
  const { data, error } = await ctx.supabase.rpc('apply_ipc_update', { p_ipc_id: ipcId, p_effective_date: date, p_version_label: label })
  if (error) return { error: cleanDbError(error.message) }

  revalidatePath('/admin/ipc')
  revalidatePath('/admin/catalogo')
  revalidatePath('/admin')
  return { data: { ...(data as IpcApplyResult), label } }
}

// Versiones generadas por un IPC (trazabilidad IPC -> listas vía source_ipc_id).
export async function getVersionsGeneratedByIpc(ipcId: string) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const { data, error } = await ctx.supabase
    .from('price_list_versions').select('id, version_label, status, price_lists(trade_id)').eq('source_ipc_id', ipcId)
  if (error) return { error: cleanDbError(error.message) }
  return { data }
}

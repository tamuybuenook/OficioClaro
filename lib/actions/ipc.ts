'use server'

import { createClient } from '@/lib/supabase/server'
import { targetEffectiveDate } from '@/lib/services/ipc'
import { revalidatePath } from 'next/cache'

async function logAudit(entity: string, entityId: string | null, action: string, newValue: unknown) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('audit_logs').insert({ actor_id: user?.id ?? null, entity, entity_id: entityId, action, new_value: newValue })
}

export async function createIpcIndex(formData: FormData) {
  const supabase = await createClient()
  const year = Number(formData.get('year'))
  const month = Number(formData.get('month'))
  const value = Number(formData.get('value'))
  const published_date = String(formData.get('published_date'))

  const { data, error } = await supabase
    .from('ipc_indexes')
    .insert({ year, month, value, published_date, status: 'pending' })
    .select()
    .single()
  if (error) return { error: error.message }
  await logAudit('ipc_indexes', data.id, 'create', data)
  revalidatePath('/admin/ipc')
  return { data }
}

// Genera, para cada oficio, una versión BORRADOR con los precios de la última
// versión publicada + el % de IPC (Bloque 0, sección 9: mes siguiente a la
// publicación). Todo o nada: usa una función de DB transaccional, así el
// estado 'applied' nunca queda inconsistente con una aplicación parcial.
export async function applyIpcToAllPriceLists(ipcId: string) {
  const supabase = await createClient()

  const { data: ipc, error: ipcError } = await supabase.from('ipc_indexes').select('published_date').eq('id', ipcId).single()
  if (ipcError || !ipc) return { error: ipcError?.message ?? 'IPC no encontrado' }

  const { date, label } = targetEffectiveDate(ipc.published_date)

  const { data, error } = await supabase.rpc('apply_ipc_update', {
    p_ipc_id: ipcId,
    p_effective_date: date,
    p_version_label: label,
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/ipc')
  revalidatePath('/admin/catalogo')
  return { data: (data as { versions: string[] })?.versions ?? [] }
}

// Versiones generadas por un IPC (trazabilidad IPC -> listas vía source_ipc_id).
export async function getVersionsGeneratedByIpc(ipcId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('price_list_versions')
    .select('id, version_label, status, price_lists(trade_id)')
    .eq('source_ipc_id', ipcId)
  if (error) return { error: error.message }
  return { data }
}

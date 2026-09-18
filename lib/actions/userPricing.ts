'use server'

import { createClient } from '@/lib/supabase/server'
import { round2 } from '@/lib/services/pricing'
import { revalidatePath } from 'next/cache'

// Guarda/actualiza "mi precio" para un servicio. No toca la lista general ni el IPC (sección 13).
export async function setMyPrice(serviceId: string, customPrice: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { error } = await supabase
    .from('user_price_items')
    .upsert(
      { user_id: user.id, service_id: serviceId, custom_price: customPrice, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,service_id' },
    )
  if (error) return { error: error.message }
  revalidatePath('/mi-lista')
}

// Vuelve a usar el precio de referencia (deja de estar personalizado).
export async function resetMyPrice(serviceId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { error } = await supabase.from('user_price_items').delete().eq('user_id', user.id).eq('service_id', serviceId)
  if (error) return { error: error.message }
  revalidatePath('/mi-lista')
}

// UT propia para una tarea puntual (no toca el precio ni la UT general).
export async function setMyTaskUt(serviceId: string, utCoefficient: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { error } = await supabase
    .from('user_price_items')
    .upsert(
      { user_id: user.id, service_id: serviceId, custom_ut_coefficient: utCoefficient, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,service_id' },
    )
  if (error) return { error: error.message }
  revalidatePath('/mi-lista')
}

// Vista previa: cuánto quedaría mi UT y mis precios personalizados si aplico el último IPC (no guarda nada todavía).
export async function previewMyIpcUpdate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: profile } = await supabase.from('profiles').select('unit_value, last_ipc_applied_id').eq('id', user.id).single()
  const { data: ipc } = await supabase.from('ipc_indexes').select('*').order('published_date', { ascending: false }).limit(1).maybeSingle()

  if (!ipc || !profile) return { error: 'No hay un IPC cargado todavía.' }
  if (ipc.id === profile.last_ipc_applied_id) return { error: 'Ya aplicaste este IPC a tu lista personal.' }

  const { count: customPricesCount } = await supabase
    .from('user_price_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('custom_price', 'is', null)

  const currentUt = profile.unit_value
  const newUt = round2(currentUt * (1 + ipc.value / 100))
  return {
    data: {
      ipcId: ipc.id,
      ipcValue: ipc.value,
      period: `${ipc.month}/${ipc.year}`,
      currentUt,
      newUt,
      customPricesCount: customPricesCount ?? 0,
    },
  }
}

// Confirmación: guarda la nueva UT y recalcula (con el mismo %) los precios personalizados que
// el usuario haya cargado a mano. Nunca toca la lista general ni decide por el usuario (sección 8).
export async function applyMyIpcUpdate(ipcId: string, newUt: number, ipcValue: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: items } = await supabase
    .from('user_price_items')
    .select('id, custom_price')
    .eq('user_id', user.id)
    .not('custom_price', 'is', null)

  for (const item of items ?? []) {
    await supabase
      .from('user_price_items')
      .update({ custom_price: round2(item.custom_price! * (1 + ipcValue / 100)), updated_at: new Date().toISOString() })
      .eq('id', item.id)
  }

  const { error } = await supabase
    .from('profiles')
    .update({ unit_value: newUt, last_ipc_applied_id: ipcId, updated_at: new Date().toISOString() })
    .eq('id', user.id)
  if (error) return { error: error.message }
  revalidatePath('/mi-lista')
  revalidatePath('/perfil')
}
// Cambia el valor de la UT general: recalcula automáticamente todos los trabajos vinculados.
export async function setMyUnitValue(unitValue: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { error } = await supabase
    .from('profiles')
    .update({ unit_value: unitValue, updated_at: new Date().toISOString() })
    .eq('id', user.id)
  if (error) return { error: error.message }
  revalidatePath('/mi-lista')
  revalidatePath('/perfil')
}

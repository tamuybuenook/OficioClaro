'use server'

import { createClient } from '@/lib/supabase/server'
import { applyPercent } from '@/lib/money'
import { revalidatePath } from 'next/cache'
import { requireFullAccess } from '@/lib/services/access'

// Guarda/actualiza "mi precio" para un servicio. No toca la lista general ni el IPC (sección 13).
export async function setMyPrice(serviceId: string, customPrice: number) {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  if (!Number.isFinite(customPrice) || customPrice <= 0) return { error: 'El precio debe ser un número mayor a cero.' }

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
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  // Solo quita el precio manual; conserva la UT propia de la tarea si existe.
  const { error } = await supabase.from('user_price_items').update({ custom_price: null, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('service_id', serviceId)
  if (error) return { error: error.message }
  await supabase.from('user_price_items').delete().eq('user_id', user.id).eq('service_id', serviceId).is('custom_price', null).is('custom_ut_coefficient', null)
  revalidatePath('/mi-lista')
}

// Quita la UT propia de la tarea (vuelve a UT general × mi UT); conserva el precio manual si existe.
export async function resetMyTaskUt(serviceId: string) {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { error } = await supabase.from('user_price_items').update({ custom_ut_coefficient: null, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('service_id', serviceId)
  if (error) return { error: error.message }
  await supabase.from('user_price_items').delete().eq('user_id', user.id).eq('service_id', serviceId).is('custom_price', null).is('custom_ut_coefficient', null)
  revalidatePath('/mi-lista')
}

// UT propia para una tarea puntual (no toca el precio ni la UT general).
export async function setMyTaskUt(serviceId: string, utCoefficient: number) {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  if (!Number.isFinite(utCoefficient) || utCoefficient <= 0) return { error: 'La UT de la tarea debe ser un número mayor a cero.' }

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
  const { data: ipc } = await supabase.from('ipc_indexes').select('*').order('published_date', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (!ipc || !profile) return { error: 'No hay un IPC cargado todavía.' }
  if (ipc.id === profile.last_ipc_applied_id) return { error: 'Ya aplicaste este IPC a tu lista personal.' }

  const { count: customPricesCount } = await supabase
    .from('user_price_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('custom_price', 'is', null)

  const currentUt = profile.unit_value
  const newUt = applyPercent(currentUt, ipc.value)
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

// Confirmación: función SQL atómica e idempotente. Calcula en la base (no confía en valores del cliente),
// actualiza la UT personal (con historial) y los precios manuales del usuario; nunca toca la lista general.
export async function applyMyIpcUpdate(ipcId: string) {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data, error } = await supabase.rpc('apply_my_ipc_update', { p_ipc_id: ipcId })
  if (error) return { error: error.message.replace(/^.*?ERROR:\s*/, '') }
  revalidatePath('/mi-lista')
  revalidatePath('/perfil')
  return { data: data as { new_ut: number; prices_updated: number; ipc_value: number } }
}
// Cambia el valor de la UT general: recalcula automáticamente todos los trabajos vinculados.
// Pasa por set_ut_value() para que quede registrado en el histórico (nunca pisa el anterior).
export async function setMyUnitValue(unitValue: number) {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  if (!Number.isFinite(unitValue) || unitValue <= 0) return { error: 'El valor de UT debe ser mayor a cero.' }

  const { error } = await supabase.rpc('set_ut_value', { p_user_id: user.id, p_value: unitValue, p_note: null })
  if (error) return { error: error.message }
  revalidatePath('/mi-lista')
  revalidatePath('/perfil')
}

export async function getMyUtHistory() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase.from('ut_history').select('*').eq('user_id', user.id).order('valid_from', { ascending: false })
  return data ?? []
}

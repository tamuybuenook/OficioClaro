'use server'

import { createClient } from '@/lib/supabase/server'
import { getMyEnabledTradeIds, getMyTradeLimit } from '@/lib/services/userTrades'
import { revalidatePath } from 'next/cache'

const LOCKED = 'Los oficios ya confirmados no se pueden quitar: tus datos y trabajos se conservan.'

// Única vía para elegir oficios: valida TODO en el servidor (no depende de la interfaz) y la base lo vuelve a exigir
// (trigger enforce_user_trades_limit), así que tampoco se elude escribiendo directo con la clave pública.
// - Se envía la selección COMPLETA deseada. Los oficios ya confirmados no se pueden quitar (conserva datos y trabajos).
// - Solo se agregan los nuevos, hasta el límite del plan vigente (p.ej. Básico -> Medium permite sumar hasta 3).
// - Bajar de plan no borra nada: simplemente no deja agregar más mientras se supere el límite.
// - Solo acepta oficios existentes y activos; se insertan todos juntos o ninguno.
export async function confirmTrades(tradeIds: string[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const ids = Array.from(new Set((Array.isArray(tradeIds) ? tradeIds : []).filter((x) => typeof x === 'string')))
  if (ids.length === 0) return { error: 'Elegí al menos un oficio.' }

  const [current, limit] = await Promise.all([getMyEnabledTradeIds(user.id), getMyTradeLimit(user.id)])
  if (limit === 0) return { error: 'Necesitás una suscripción activa para elegir oficios.' }
  if (current.some((c) => !ids.includes(c))) return { error: LOCKED }
  const additions = ids.filter((id) => !current.includes(id))
  if (additions.length === 0) return { error: 'No elegiste oficios nuevos.' }
  if (limit !== null && current.length + additions.length > limit) {
    const room = Math.max(0, limit - current.length)
    return { error: room === 0 ? `Tu plan permite hasta ${limit} oficio(s) y ya los tenés. Ampliá tu plan para agregar más.` : `Tu plan permite hasta ${limit} oficio(s): podés agregar ${room} más.` }
  }

  const { data: valid, error: vErr } = await supabase.from('trades').select('id').in('id', additions).eq('is_active', true)
  if (vErr) return { error: vErr.message }
  if ((valid ?? []).length !== additions.length) return { error: 'Alguno de los oficios elegidos no está disponible.' }

  const { error } = await supabase.from('user_trades').insert(additions.map((trade_id) => ({ user_id: user.id, trade_id })))
  if (error) return { error: (error as any).code === '23505' ? 'Alguno de esos oficios ya estaba activo. Actualizá la página.' : error.message }
  revalidatePath('/')
  return { data: true }
}

// Alta/baja individual deshabilitadas: la selección se fija una sola vez con confirmTrades (doble confirmación).
export async function enableTrade(_tradeId: string) {
  return { error: 'Elegí tus oficios desde “Mis oficios” y confirmá la selección.' }
}

export async function disableTrade(_tradeId: string) {
  return { error: LOCKED }
}

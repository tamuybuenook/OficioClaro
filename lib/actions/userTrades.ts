'use server'

import { createClient } from '@/lib/supabase/server'
import { getMyEnabledTradeIds, getMyTradeLimit } from '@/lib/services/userTrades'
import { revalidatePath } from 'next/cache'

// Crea la lista personal del oficio (sección 3/6): el usuario solo copia lo
// correspondiente a su actividad, nunca todos los oficios existentes.
export async function enableTrade(tradeId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const [current, limit] = await Promise.all([getMyEnabledTradeIds(user.id), getMyTradeLimit(user.id)])
  if (current.includes(tradeId)) return { data: true }
  if (limit !== null && current.length >= limit) {
    return { error: limit === 0 ? 'Necesitás una suscripción activa para agregar oficios.' : `Tu plan permite hasta ${limit} oficio(s). Ampliá tu plan para agregar más.` }
  }

  const { error } = await supabase.from('user_trades').insert({ user_id: user.id, trade_id: tradeId })
  if (error) return { error: error.message }
  revalidatePath('/')
  revalidatePath('/mis-oficios')
}

export async function disableTrade(tradeId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { error } = await supabase.from('user_trades').delete().eq('user_id', user.id).eq('trade_id', tradeId)
  if (error) return { error: error.message }
  revalidatePath('/')
  revalidatePath('/mis-oficios')
}

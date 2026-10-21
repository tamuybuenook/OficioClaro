import { createClient } from '@/lib/supabase/server'
import { getMyAccess } from '@/lib/services/access'

export async function getMyEnabledTradeIds(userId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('user_trades').select('trade_id').eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((r) => r.trade_id)
}

// null = sin límite (plan Full o sin límite configurado). 0 = sin acceso (sin suscripción, vencida fuera de gracia o suspendida).
// El acceso sale de la fase de la suscripción (lib/services/access.ts): la gracia conserva el acceso completo.
export async function getMyTradeLimit(_userId: string): Promise<number | null> {
  const access = await getMyAccess()
  if (!access.hasAccess) return 0
  return access.maxTrades
}

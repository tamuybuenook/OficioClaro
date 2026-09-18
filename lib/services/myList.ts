import { createClient } from '@/lib/supabase/server'
import { getServicePricing } from '@/lib/services/pricing'
import { getMyEnabledTradeIds } from '@/lib/services/userTrades'

export async function getMyList() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const tradeIds = await getMyEnabledTradeIds(user.id)
  if (tradeIds.length === 0) return []

  const { data: services, error } = await supabase
    .from('services')
    .select('id, name, unit_label, ut_coefficient, categories!inner(name, trade_id, trades(name))')
    .in('categories.trade_id', tradeIds)
  if (error) throw error

  const pricings = await Promise.all(
    (services ?? []).map(async (s) => ({ service: s, pricing: await getServicePricing(s.id, user.id) })),
  )
  return pricings.filter((p) => p.pricing !== null)
}

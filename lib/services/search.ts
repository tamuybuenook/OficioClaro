import { createClient } from '@/lib/supabase/server'
import { getServicePricing } from '@/lib/services/pricing'
import { getMyEnabledTradeIds } from '@/lib/services/userTrades'

// ABRO -> BUSCO EL TRABAJO -> VEO EL PRECIO (sección 2/17/18).
// Tolera parciales ("canilla", "cambio canilla") vía ilike (pg_trgm en la columna, ver 0001_schema.sql).
export async function searchPrices(query: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const trimmed = query.trim()
  if (!trimmed || !user) return []

  const tradeIds = await getMyEnabledTradeIds(user.id)
  if (tradeIds.length === 0) return []

  const words = trimmed.split(/\s+/).filter(Boolean)
  let builder = supabase
    .from('services')
    .select('id, name, unit_label, categories!inner(name, trade_id, trades(name))')
    .in('categories.trade_id', tradeIds)
  for (const word of words) {
    builder = builder.ilike('name', `%${word}%`)
  }
  const { data: services, error } = await builder.limit(15)
  if (error) throw error

  const results = await Promise.all(
    (services ?? []).map(async (s) => ({ service: s, pricing: await getServicePricing(s.id, user.id) })),
  )
  return results.filter((r) => r.pricing !== null)
}

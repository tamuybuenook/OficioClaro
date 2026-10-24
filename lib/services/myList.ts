import { createClient } from '@/lib/supabase/server'
import { getPricingBatch } from '@/lib/services/pricingBatch'
import { getMyEnabledTradeIds } from '@/lib/services/userTrades'

const PAGE = 1000 // PostgREST devuelve como máximo 1000 filas por consulta: se pide por tramos para no cortar la lista en silencio

export async function getMyList() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const tradeIds = await getMyEnabledTradeIds(user.id)
  if (tradeIds.length === 0) return []

  const services: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, unit_label, ut_coefficient, categories!inner(name, trade_id, trades(name))')
      .in('categories.trade_id', tradeIds)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    services.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE) break
  }

  // Precios de TODOS los servicios con un número fijo de consultas (antes: ~6 por servicio, una tras otra).
  const pricing = await getPricingBatch(supabase, user.id, services.map((s) => s.id))
  return services.flatMap((s) => {
    const p = pricing.get(s.id)
    return p ? [{ service: s, pricing: p }] : []
  })
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolvePersonalPrice, type ServicePricing } from '@/lib/services/pricing'

// Precio de MUCHOS servicios con un número FIJO de consultas (antes: ~6 consultas por servicio, en serie).
// Misma regla que getServicePricing(): lista del oficio -> versión publicada vigente -> precio base ->
// precio personal (explícito > UT propia de la tarea > UT general × mi UT > referencia).
// Un servicio sin lista, sin versión vigente o sin ítem devuelve "sin precio" (no aparece en el mapa).

// Las URL de PostgREST tienen largo máximo: los `in (...)` se parten en bloques.
const CHUNK = 100
const chunk = <T,>(xs: T[], n = CHUNK) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

export async function getPricingBatch(
  supabase: SupabaseClient, userId: string | null, serviceIds: string[], today = new Date().toISOString().slice(0, 10),
): Promise<Map<string, ServicePricing>> {
  const out = new Map<string, ServicePricing>()
  const ids = [...new Set(serviceIds)]
  if (ids.length === 0) return out

  // 1) servicios (coeficiente UT + oficio) y, en paralelo, datos del usuario
  const [serviceRows, profileRes, userItemRows] = await Promise.all([
    Promise.all(chunk(ids).map(async (c) => {
      const { data, error } = await supabase.from('services').select('id, ut_coefficient, categories(trade_id)').in('id', c)
      if (error) throw error
      return data ?? []
    })).then((r) => r.flat() as any[]),
    userId ? supabase.from('profiles').select('unit_value').eq('id', userId).maybeSingle() : Promise.resolve({ data: null }),
    userId
      ? Promise.all(chunk(ids).map(async (c) => {
          const { data, error } = await supabase.from('user_price_items').select('service_id, custom_price, custom_ut_coefficient').eq('user_id', userId).in('service_id', c)
          if (error) throw error
          return data ?? []
        })).then((r) => r.flat() as any[])
      : Promise.resolve([] as any[]),
  ])
  const unitValue: number | null = (profileRes as any).data?.unit_value ?? null
  const userItems = new Map<string, any>(userItemRows.map((r) => [r.service_id, r]))

  const tradeOf = (s: any): string | undefined => (Array.isArray(s.categories) ? s.categories[0] : s.categories)?.trade_id
  const tradeIds = [...new Set(serviceRows.map(tradeOf).filter(Boolean) as string[])]
  if (tradeIds.length === 0) return out

  // 2) lista de cada oficio
  const { data: lists, error: listErr } = await supabase.from('price_lists').select('id, trade_id').in('trade_id', tradeIds)
  if (listErr) throw listErr
  const listByTrade = new Map<string, string>()
  for (const l of lists ?? []) if (!listByTrade.has(l.trade_id)) listByTrade.set(l.trade_id, l.id)
  if (listByTrade.size === 0) return out

  // 3) versión publicada vigente de cada lista (la de fecha de vigencia más reciente que ya empezó)
  const { data: versions, error: verErr } = await supabase
    .from('price_list_versions').select('id, price_list_id, effective_date')
    .in('price_list_id', [...listByTrade.values()]).eq('status', 'published').lte('effective_date', today)
    .order('effective_date', { ascending: false })
  if (verErr) throw verErr
  const versionByList = new Map<string, string>()
  for (const v of versions ?? []) if (!versionByList.has(v.price_list_id)) versionByList.set(v.price_list_id, v.id)
  if (versionByList.size === 0) return out

  // 4) precios base de esas versiones para esos servicios
  const versionIds = [...versionByList.values()]
  const itemRows = (await Promise.all(chunk(ids).map(async (c) => {
    const { data, error } = await supabase.from('price_items').select('service_id, price_list_version_id, base_price').in('price_list_version_id', versionIds).in('service_id', c)
    if (error) throw error
    return data ?? []
  }))).flat() as any[]
  const baseByVersionService = new Map<string, number>(itemRows.map((r) => [`${r.price_list_version_id}|${r.service_id}`, r.base_price]))

  for (const s of serviceRows) {
    const trade = tradeOf(s)
    const versionId = trade ? versionByList.get(listByTrade.get(trade) ?? '') : undefined
    if (!versionId) continue
    const base = baseByVersionService.get(`${versionId}|${s.id}`)
    if (base == null) continue
    const u = userItems.get(s.id)
    const personal = resolvePersonalPrice({
      customPrice: u?.custom_price ?? null,
      customUtCoefficient: u?.custom_ut_coefficient ?? null,
      utCoefficient: s.ut_coefficient,
      unitValue,
      referencePrice: base,
    })
    out.set(s.id, {
      serviceId: s.id,
      basePrice: base,
      referencePrice: base,
      personalPrice: personal.price,
      personalSource: personal.source,
      personalUtCoefficient: u?.custom_ut_coefficient ?? null,
    })
  }
  return out
}

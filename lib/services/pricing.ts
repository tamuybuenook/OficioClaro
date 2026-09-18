import { createClient } from '@/lib/supabase/server'

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// coeficiente UT × valor UT del profesional (sección 12)
export function calculateUtPrice(coefficient: number, unitValue: number): number {
  return round2(coefficient * unitValue)
}

// "Mi precio": prioridad = precio explícito > UT propia para esa tarea > UT general × mi UT > general
export function resolvePersonalPrice(params: {
  customPrice?: number | null
  customUtCoefficient?: number | null
  utCoefficient?: number | null
  unitValue?: number | null
  referencePrice: number
}): { price: number; source: 'custom' | 'custom-ut' | 'ut' | 'reference' } {
  if (params.customPrice != null) return { price: params.customPrice, source: 'custom' }
  if (params.customUtCoefficient != null && params.unitValue) {
    return { price: calculateUtPrice(params.customUtCoefficient, params.unitValue), source: 'custom-ut' }
  }
  if (params.utCoefficient != null && params.unitValue) {
    return { price: calculateUtPrice(params.utCoefficient, params.unitValue), source: 'ut' }
  }
  return { price: params.referencePrice, source: 'reference' }
}

export interface ServicePricing {
  serviceId: string
  basePrice: number
  referencePrice: number
  personalPrice: number
  personalSource: 'custom' | 'custom-ut' | 'ut' | 'reference'
}

// Orquestador: junta lista vigente + precio personalizado del profesional.
// Nota (Bloque 0, sección 11): OficioClaro NO administra zonas/ajustes regionales;
// "precio general" y "precio de referencia" son el mismo valor de la lista maestra.
export async function getServicePricing(serviceId: string, userId?: string | null): Promise<ServicePricing | null> {
  const supabase = await createClient()

  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('id, ut_coefficient, category_id, categories(trade_id)')
    .eq('id', serviceId)
    .single()
  if (serviceError || !service) return null

  const tradeId = (service as any).categories?.trade_id
  const { data: priceList } = await supabase.from('price_lists').select('id').eq('trade_id', tradeId).maybeSingle()
  if (!priceList) return null

  const { data: version } = await supabase
    .from('price_list_versions')
    .select('id')
    .eq('price_list_id', priceList.id)
    .eq('status', 'published')
    .lte('effective_date', new Date().toISOString().slice(0, 10))
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!version) return null

  const { data: item } = await supabase
    .from('price_items')
    .select('base_price')
    .eq('price_list_version_id', version.id)
    .eq('service_id', serviceId)
    .maybeSingle()
  if (!item) return null

  let unitValue: number | null = null
  let customPrice: number | null = null
  let customUtCoefficient: number | null = null

  if (userId) {
    const { data: profile } = await supabase.from('profiles').select('unit_value').eq('id', userId).maybeSingle()
    unitValue = profile?.unit_value ?? null

    const { data: userItem } = await supabase
      .from('user_price_items')
      .select('custom_price, custom_ut_coefficient')
      .eq('user_id', userId)
      .eq('service_id', serviceId)
      .maybeSingle()
    customPrice = userItem?.custom_price ?? null
    customUtCoefficient = userItem?.custom_ut_coefficient ?? null
  }

  const referencePrice = item.base_price
  const personal = resolvePersonalPrice({
    customPrice,
    customUtCoefficient,
    utCoefficient: service.ut_coefficient,
    unitValue,
    referencePrice,
  })

  return {
    serviceId,
    basePrice: item.base_price,
    referencePrice,
    personalPrice: personal.price,
    personalSource: personal.source,
  }
}

import { createClient } from '@/lib/supabase/server'

export async function getPriceListByTrade(tradeId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('price_lists').select('*').eq('trade_id', tradeId).maybeSingle()
  if (error) throw error
  return data
}

export async function getVersions(priceListId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('price_list_versions')
    .select('*')
    .eq('price_list_id', priceListId)
    .order('effective_date', { ascending: false })
  if (error) throw error
  return data
}

// La versión vigente para el usuario final: la publicada más reciente por fecha de vigencia.
export async function getCurrentPublishedVersion(priceListId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('price_list_versions')
    .select('*')
    .eq('price_list_id', priceListId)
    .eq('status', 'published')
    .lte('effective_date', new Date().toISOString().slice(0, 10))
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getPriceItems(versionId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('price_items')
    .select('*, services(name, unit_label, ut_coefficient, category_id)')
    .eq('price_list_version_id', versionId)
  if (error) throw error
  return data
}

// Precio de un servicio en una fecha dada (por defecto, hoy), a partir del histórico.
export async function getPriceItemAt(serviceId: string, date: string = new Date().toISOString().slice(0, 10)) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('price_items')
    .select('*, price_list_versions!inner(status, effective_date)')
    .eq('service_id', serviceId)
    .eq('price_list_versions.status', 'published')
    .lte('price_list_versions.effective_date', date)
    .order('effective_date', { foreignTable: 'price_list_versions', ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

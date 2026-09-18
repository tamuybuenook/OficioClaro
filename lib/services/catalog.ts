import { createClient } from '@/lib/supabase/server'

export async function getTrades() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('trades').select('*').order('name')
  if (error) throw error
  return data
}

export async function getCategoriesByTrade(tradeId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('trade_id', tradeId)
    .order('name')
  if (error) throw error
  return data
}

export async function getServicesByCategory(categoryId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('category_id', categoryId)
    .order('name')
  if (error) throw error
  return data
}

// Búsqueda tolerante a parciales (usa pg_trgm vía ilike; ver 0001_schema.sql)
export async function searchServices(query: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('services')
    .select('*, categories(name, trades(name))')
    .ilike('name', `%${query}%`)
    .limit(20)
  if (error) throw error
  return data
}

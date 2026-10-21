'use server'

import { createClient } from '@/lib/supabase/server'
import { getMyEnabledTradeIds } from '@/lib/services/userTrades'
import { getServicePricing } from '@/lib/services/pricing'
import { getMasterUtCurrent } from '@/lib/services/masterUt'
import type { Job } from '@/components/types'

const CATALOG_PAGE_SIZE = 10

export type CategoryCount = { id: string; name: string; count: number }
export type CategoryPage = { jobs: Job[]; total: number; page: number; pageSize: number }

// Escapa comodines de LIKE para que "50%" o "_" se busquen como texto.
const esc = (w: string) => w.replace(/[\\%_]/g, (c) => `\\${c}`)
const words = (q: string) => q.trim().split(/\s+/).filter(Boolean).slice(0, 6)

// Autorización en el servidor: el oficio debe estar entre los habilitados del usuario.
async function authorize(tradeId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const enabled = await getMyEnabledTradeIds(user.id)
  if (!enabled.includes(tradeId)) return null
  return { supabase, user }
}

// Categorías del oficio con la cantidad de trabajos que coinciden con la búsqueda (sobre TODO el catálogo del oficio).
export async function fetchTradeCategories(tradeId: string, q: string): Promise<CategoryCount[]> {
  const ctx = await authorize(tradeId)
  if (!ctx) return []
  const { supabase } = ctx
  const { data: cats, error } = await supabase.from('categories').select('id, name').eq('trade_id', tradeId).order('name')
  if (error) throw error
  const ws = words(q)
  const counts = await Promise.all((cats ?? []).map(async (c) => {
    let b = supabase.from('services').select('id', { count: 'exact', head: true }).eq('category_id', c.id)
    for (const w of ws) b = b.ilike('name', `%${esc(w)}%`)
    const { count } = await b
    return { id: c.id, name: c.name, count: count ?? 0 }
  }))
  return counts.filter((c) => c.count > 0)
}

// Una página de una categoría (paginación independiente por categoría, resuelta en la base con range()).
export async function fetchCategoryPage(tradeId: string, categoryId: string, q: string, page: number): Promise<CategoryPage> {
  const empty = { jobs: [], total: 0, page: 1, pageSize: CATALOG_PAGE_SIZE }
  const ctx = await authorize(tradeId)
  if (!ctx) return empty
  const { supabase, user } = ctx
  const safePage = Math.max(1, Math.floor(page) || 1)
  const from = (safePage - 1) * CATALOG_PAGE_SIZE

  let b = supabase
    .from('services')
    .select('id, name, unit_label, ut_coefficient, categories!inner(name, trade_id, trades(name))', { count: 'exact' })
    .eq('category_id', categoryId)
    .eq('categories.trade_id', tradeId) // la categoría debe pertenecer al oficio autorizado
    .order('name')
    .range(from, from + CATALOG_PAGE_SIZE - 1)
  for (const w of words(q)) b = b.ilike('name', `%${esc(w)}%`)
  const { data: services, count, error } = await b
  if (error) throw error

  const masterUtValue = await getMasterUtCurrent()
  const rows = await Promise.all((services ?? []).map(async (s) => ({ s, pricing: await getServicePricing(s.id, user.id) })))
  const jobs: Job[] = rows.filter((r) => r.pricing).map(({ s, pricing }) => ({
    id: s.id,
    name: s.name,
    category: (s as any).categories?.name ?? 'General',
    trade: (s as any).categories?.trades?.name ?? 'General',
    unit: s.unit_label,
    base: pricing!.basePrice,
    regional: pricing!.referencePrice,
    personal: pricing!.personalPrice,
    module: (s as any).ut_coefficient != null ? `${(s as any).ut_coefficient} UT` : null,
    masterUtQty: (s as any).ut_coefficient ?? null,
    masterUtValue,
    personalUtQty: pricing!.personalUtCoefficient,
  }))
  return { jobs, total: count ?? 0, page: safePage, pageSize: CATALOG_PAGE_SIZE }
}

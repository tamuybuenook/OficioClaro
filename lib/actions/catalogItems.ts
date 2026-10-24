'use server'

import { createClient } from '@/lib/supabase/server'
import { requireFullAccess } from '@/lib/services/access'
import { cleanCatalogInput, type CatalogItemInput, type CatalogFieldErrors } from '@/lib/catalogItems'
import { likeEscape, searchWords, type OwnCatalogItem } from '@/lib/quotes'

// Catálogo PROPIO del profesional (tabla catalog_items, migración 0035).
// La propiedad la fija la base de datos (trigger + RLS): este código NUNCA envía user_id.
// Todas las consultas igualmente filtran por el usuario autenticado, y la RLS lo vuelve a exigir.

const PAGE_SIZE = 30
const COLS = 'id, name, description, category, unit_label, unit_price, is_active, updated_at'

type Fail = { error: string; fieldErrors?: CatalogFieldErrors }

function friendly(e: { code?: string; message?: string }): string {
  if (e.code === '23505') return 'Ya tenés un concepto activo con ese nombre.'
  if (e.code === '23514') return 'Los datos del concepto no son válidos. Revisá nombre, unidad y precio.'
  if (e.code === '42P01' || e.code === 'PGRST205') return 'Tu catálogo propio necesita una actualización de la base de datos que todavía no se aplicó. Avisá a soporte; no se guardó nada.'
  return 'No se pudo guardar. Revisá tu conexión e intentá de nuevo.'
}

async function ctx() {
  const denied = await requireFullAccess()
  if (denied) return { fail: { error: denied.error } as Fail }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { fail: { error: 'No autenticado' } as Fail }
  return { supabase, user }
}

export type OwnCatalogPage = { items: OwnCatalogItem[]; total: number; page: number; pageSize: number }

export async function listOwnCatalog(params: { q?: string; includeInactive?: boolean; page?: number }): Promise<OwnCatalogPage | { error: string }> {
  const c = await ctx()
  if ('fail' in c) return { error: c.fail!.error }
  const page = Math.max(1, Math.floor(params.page ?? 1) || 1)
  const from = (page - 1) * PAGE_SIZE
  let b = c.supabase.from('catalog_items').select(COLS, { count: 'exact' }).eq('user_id', c.user.id).order('name').range(from, from + PAGE_SIZE - 1)
  if (!params.includeInactive) b = b.eq('is_active', true)
  for (const w of searchWords(params.q ?? '')) {
    const e = likeEscape(w)
    b = b.or(`name.ilike.%${e}%,category.ilike.%${e}%`)
  }
  const { data, count, error } = await b
  if (error) return { error: friendly(error) === 'No se pudo guardar. Revisá tu conexión e intentá de nuevo.' ? 'No se pudo cargar tu catálogo. Revisá tu conexión e intentá de nuevo.' : friendly(error) }
  return { items: (data ?? []) as OwnCatalogItem[], total: count ?? 0, page, pageSize: PAGE_SIZE }
}

export async function createCatalogItem(input: CatalogItemInput): Promise<{ data: OwnCatalogItem } | Fail> {
  const c = await ctx()
  if ('fail' in c) return c.fail!
  const clean = cleanCatalogInput(input)
  if (!clean.value) return { error: 'Revisá los datos marcados.', fieldErrors: clean.errors }
  const v = clean.value
  const { data, error } = await c.supabase.from('catalog_items')
    .insert({ name: v.name, description: v.description, category: v.category, unit_label: v.unit_label, unit_price: v.unit_price }) // sin user_id: lo pone la base
    .select(COLS).single()
  if (error || !data) return { error: friendly(error ?? {}), fieldErrors: error?.code === '23505' ? { name: 'Ya existe un concepto activo con este nombre.' } : undefined }
  return { data: data as OwnCatalogItem }
}

export async function updateCatalogItem(id: string, input: CatalogItemInput): Promise<{ data: OwnCatalogItem } | Fail> {
  const c = await ctx()
  if ('fail' in c) return c.fail!
  const clean = cleanCatalogInput(input)
  if (!clean.value) return { error: 'Revisá los datos marcados.', fieldErrors: clean.errors }
  const v = clean.value
  const { data, error } = await c.supabase.from('catalog_items')
    .update({ name: v.name, description: v.description, category: v.category, unit_label: v.unit_label, unit_price: v.unit_price })
    .eq('id', id).eq('user_id', c.user.id).select(COLS).maybeSingle()
  if (error) return { error: friendly(error), fieldErrors: error.code === '23505' ? { name: 'Ya existe un concepto activo con este nombre.' } : undefined }
  if (!data) return { error: 'No encontramos ese concepto.' }
  return { data: data as OwnCatalogItem }
}

export async function setCatalogItemActive(id: string, active: boolean): Promise<{ data: OwnCatalogItem } | Fail> {
  const c = await ctx()
  if ('fail' in c) return c.fail!
  const { data, error } = await c.supabase.from('catalog_items').update({ is_active: active }).eq('id', id).eq('user_id', c.user.id).select(COLS).maybeSingle()
  if (error) return { error: error.code === '23505' ? 'No se puede reactivar: ya tenés otro concepto activo con ese nombre.' : friendly(error) }
  if (!data) return { error: 'No encontramos ese concepto.' }
  return { data: data as OwnCatalogItem }
}

'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getAdminContext, cleanDbError } from '@/lib/auth/assert-admin'

async function logAudit(entity: string, entityId: string | null, action: string, newValue: unknown) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('audit_logs').insert({
    actor_id: user?.id ?? null,
    entity,
    entity_id: entityId,
    action,
    new_value: newValue,
  })
}

// Carga administrativa por oficio: el admin pega "Categoría;Trabajo;UT". Una sola transacción SQL:
// valida todo antes de escribir (si una fila falla, no se guarda nada). Idempotente. No genera precios ni versiones.
export async function bulkUpsertCatalog(tradeId: string, rows: { category: string; name: string; ut: number }[]) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const { data, error } = await ctx.supabase.rpc('bulk_upsert_catalog', { p_trade_id: tradeId, p_rows: rows })
  if (error) return { error: cleanDbError(error.message) }
  revalidatePath('/admin/catalogo')
  const r = data as { created: number; updated: number; categories_created: number }
  return { data: { created: r.created, updated: r.updated } }
}

function slugify(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function createTradeWithList(formData: FormData) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'El nombre del oficio es obligatorio.' }
  const slug = String(formData.get('slug') || slugify(name))
  if (!slug) return { error: 'No se pudo generar un identificador válido para el oficio.' }

  const { data: trade, error } = await ctx.supabase.from('trades').insert({ name, slug }).select().single()
  if (error) return { error: error.code === '23505' ? `Ya existe un oficio llamado "${name}".` : cleanDbError(error.message) }

  const { error: listError } = await ctx.supabase.from('price_lists').insert({ trade_id: trade.id, name: `${name} - Lista maestra` })
  if (listError) {
    await ctx.supabase.from('trades').delete().eq('id', trade.id) // sin dependientes todavía: se revierte
    return { error: `No se pudo crear la lista maestra: ${cleanDbError(listError.message)}` }
  }
  await logAudit('trades', trade.id, 'create', trade)
  revalidatePath('/admin/catalogo')
  return { data: trade }
}

// "Borrar" un oficio = desactivarlo: deja de ofrecerse a usuarios nuevos, sin tocar el historial de precios ya publicado.
export async function setTradeActive(tradeId: string, isActive: boolean) {
  const supabase = await createClient()
  const { error } = await supabase.from('trades').update({ is_active: isActive }).eq('id', tradeId)
  if (error) return { error: error.message }
  revalidatePath('/admin/catalogo')
}

export async function createTrade(formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const slug = String(formData.get('slug'))
  const { data, error } = await supabase.from('trades').insert({ name, slug }).select().single()
  if (error) return { error: error.message }
  await logAudit('trades', data.id, 'create', data)
  revalidatePath('/admin/catalogo')
  return { data }
}

export async function updateTrade(id: string, formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const slug = String(formData.get('slug'))
  const { error } = await supabase.from('trades').update({ name, slug }).eq('id', id)
  if (error) return { error: error.message }
  await logAudit('trades', id, 'update', { name, slug })
  revalidatePath('/admin/catalogo')
}

export async function deleteTrade(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('trades').delete().eq('id', id)
  if (error) return { error: error.message }
  await logAudit('trades', id, 'delete', null)
  revalidatePath('/admin/catalogo')
}

// ---------- categories ----------
export async function createCategory(tradeId: string, formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const { data, error } = await supabase
    .from('categories')
    .insert({ trade_id: tradeId, name })
    .select()
    .single()
  if (error) return { error: error.message }
  await logAudit('categories', data.id, 'create', data)
  revalidatePath('/admin/catalogo')
  return { data }
}

export async function deleteCategory(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) return { error: error.message }
  await logAudit('categories', id, 'delete', null)
  revalidatePath('/admin/catalogo')
}

function parseUt(raw: FormDataEntryValue | null): { value: number | null } | { error: string } {
  const text = String(raw ?? '').trim().replace(',', '.')
  if (!text) return { value: null }
  const n = Number(text)
  if (!Number.isFinite(n) || n <= 0) return { error: 'La UT debe ser un número mayor a cero (ej: 2,5).' }
  return { value: n }
}

// ---------- services ----------
export async function createService(categoryId: string, formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const unit_label = String(formData.get('unit_label') || 'Trabajo')
  const parsed = parseUt(formData.get('ut_coefficient'))
  if ('error' in parsed) return { error: parsed.error }
  const ut_coefficient = parsed.value

  const { data, error } = await supabase
    .from('services')
    .insert({ category_id: categoryId, name, unit_label, ut_coefficient })
    .select()
    .single()
  if (error) return { error: error.message }
  await logAudit('services', data.id, 'create', data)
  revalidatePath('/admin/catalogo')
  return { data }
}

export async function updateService(id: string, formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const unit_label = String(formData.get('unit_label') || 'Trabajo')
  const parsed = parseUt(formData.get('ut_coefficient'))
  if ('error' in parsed) return { error: parsed.error }
  const ut_coefficient = parsed.value

  const { error } = await supabase
    .from('services')
    .update({ name, unit_label, ut_coefficient })
    .eq('id', id)
  if (error) return { error: error.message }
  await logAudit('services', id, 'update', { name, unit_label, ut_coefficient })
  revalidatePath('/admin/catalogo')
  return { data: { id } }
}

export async function deleteService(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('services').delete().eq('id', id)
  if (error) return { error: error.message }
  await logAudit('services', id, 'delete', null)
  revalidatePath('/admin/catalogo')
  return { data: { id } }
}

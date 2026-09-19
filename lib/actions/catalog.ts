'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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

// ---------- trades ----------
// Carga administrativa por oficio (Bloque de cierre, sección 2): el admin pega
// "Categoría;Trabajo;UT" para UNA actividad y acá se crean/actualizan categorías
// y servicios. No genera precios ni versiones: eso sigue el flujo ya existente
// (crear versión -> generar desde UT -> publicar).
export async function bulkUpsertCatalog(tradeId: string, rows: { category: string; name: string; ut: number }[]) {
  const supabase = await createClient()
  let created = 0
  let updated = 0

  const categoryCache = new Map<string, string>()

  for (const row of rows) {
    let categoryId = categoryCache.get(row.category)
    if (!categoryId) {
      const { data: existing } = await supabase
        .from('categories')
        .select('id')
        .eq('trade_id', tradeId)
        .eq('name', row.category)
        .maybeSingle()
      if (existing) {
        categoryId = existing.id
      } else {
        const { data: newCat, error } = await supabase
          .from('categories')
          .insert({ trade_id: tradeId, name: row.category })
          .select('id')
          .single()
        if (error) return { error: `Categoría "${row.category}": ${error.message}` }
        categoryId = newCat.id
      }
      categoryCache.set(row.category, categoryId)
    }

    const { data: existingService } = await supabase
      .from('services')
      .select('id')
      .eq('category_id', categoryId)
      .eq('name', row.name)
      .maybeSingle()

    if (existingService) {
      const { error } = await supabase.from('services').update({ ut_coefficient: row.ut }).eq('id', existingService.id)
      if (error) return { error: `"${row.name}": ${error.message}` }
      updated++
    } else {
      const { error } = await supabase.from('services').insert({ category_id: categoryId, name: row.name, unit_label: 'Trabajo', ut_coefficient: row.ut })
      if (error) return { error: `"${row.name}": ${error.message}` }
      created++
    }
  }

  await logAudit('services', tradeId, 'bulk_upsert', { created, updated })
  revalidatePath('/admin/catalogo')
  return { data: { created, updated } }
}

export async function createTradeWithList(formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const slug = String(formData.get('slug') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))

  const { data: trade, error } = await supabase.from('trades').insert({ name, slug }).select().single()
  if (error) return { error: error.message }

  await supabase.from('price_lists').insert({ trade_id: trade.id, name: `${name} - Lista maestra` })
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
  revalidatePath('/admin/oficios')
  return { data }
}

export async function updateTrade(id: string, formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const slug = String(formData.get('slug'))
  const { error } = await supabase.from('trades').update({ name, slug }).eq('id', id)
  if (error) return { error: error.message }
  await logAudit('trades', id, 'update', { name, slug })
  revalidatePath('/admin/oficios')
}

export async function deleteTrade(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('trades').delete().eq('id', id)
  if (error) return { error: error.message }
  await logAudit('trades', id, 'delete', null)
  revalidatePath('/admin/oficios')
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
  revalidatePath('/admin/oficios')
  return { data }
}

export async function deleteCategory(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) return { error: error.message }
  await logAudit('categories', id, 'delete', null)
  revalidatePath('/admin/oficios')
}

// ---------- services ----------
export async function createService(categoryId: string, formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const unit_label = String(formData.get('unit_label') || 'Trabajo')
  const utRaw = formData.get('ut_coefficient')
  const ut_coefficient = utRaw ? Number(utRaw) : null

  const { data, error } = await supabase
    .from('services')
    .insert({ category_id: categoryId, name, unit_label, ut_coefficient })
    .select()
    .single()
  if (error) return { error: error.message }
  await logAudit('services', data.id, 'create', data)
  revalidatePath('/admin/oficios')
  return { data }
}

export async function updateService(id: string, formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const unit_label = String(formData.get('unit_label') || 'Trabajo')
  const utRaw = formData.get('ut_coefficient')
  const ut_coefficient = utRaw ? Number(utRaw) : null

  const { error } = await supabase
    .from('services')
    .update({ name, unit_label, ut_coefficient })
    .eq('id', id)
  if (error) return { error: error.message }
  await logAudit('services', id, 'update', { name, unit_label, ut_coefficient })
  revalidatePath('/admin/oficios')
}

export async function deleteService(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('services').delete().eq('id', id)
  if (error) return { error: error.message }
  await logAudit('services', id, 'delete', null)
  revalidatePath('/admin/oficios')
}

'use server'

import { createClient } from '@/lib/supabase/server'
import { round2 } from '@/lib/services/pricing'
import { revalidatePath } from 'next/cache'

async function logAudit(entity: string, entityId: string | null, action: string, newValue: unknown) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('audit_logs').insert({ actor_id: user?.id ?? null, entity, entity_id: entityId, action, new_value: newValue })
}

export async function createPriceList(tradeId: string, name: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('price_lists').insert({ trade_id: tradeId, name }).select().single()
  if (error) return { error: error.message }
  return { data }
}

// Crea una versión en borrador (no vigente hasta publicarla).
export async function createVersion(priceListId: string, formData: FormData) {
  const supabase = await createClient()
  const version_label = String(formData.get('version_label'))
  const effective_date = String(formData.get('effective_date'))

  const { data, error } = await supabase
    .from('price_list_versions')
    .insert({ price_list_id: priceListId, version_label, effective_date, status: 'draft' })
    .select()
    .single()
  if (error) return { error: error.message }
  await logAudit('price_list_versions', data.id, 'create', data)
  revalidatePath('/admin/listas')
  return { data }
}

// Copia los precios de una versión existente a una nueva versión en borrador
// (para no recargar todo a mano cada mes; los valores se ajustan después con IPC/manual).
export async function duplicateVersionItems(fromVersionId: string, toVersionId: string) {
  const supabase = await createClient()
  const { data: items, error: readError } = await supabase
    .from('price_items')
    .select('service_id, base_price')
    .eq('price_list_version_id', fromVersionId)
  if (readError) return { error: readError.message }
  if (!items.length) return { data: [] }

  const rows = items.map((i) => ({ price_list_version_id: toVersionId, service_id: i.service_id, base_price: i.base_price }))
  const { error } = await supabase.from('price_items').insert(rows)
  if (error) return { error: error.message }
  revalidatePath('/admin/listas')
}

// Solo permitido sobre versiones en borrador (una publicada es inmutable: lo bloquea el trigger de DB).
export async function upsertPriceItem(versionId: string, serviceId: string, basePrice: number) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('price_items')
    .upsert({ price_list_version_id: versionId, service_id: serviceId, base_price: basePrice }, { onConflict: 'price_list_version_id,service_id' })
    .select()
    .single()
  if (error) return { error: error.message }
  await logAudit('price_items', data.id, 'upsert', data)
  revalidatePath('/admin/listas')
  return { data }
}

// Genera (o actualiza) los precios de una versión BORRADOR a partir de UT × valor de referencia,
// para todos los servicios del oficio que tengan UT cargada. Los que no tienen UT se cargan a mano (upsertPriceItem).
export async function generateItemsFromUt(versionId: string, referenceUtValue: number) {
  const supabase = await createClient()

  const { data: version, error: versionError } = await supabase
    .from('price_list_versions')
    .select('id, status, price_list_id, price_lists(trade_id)')
    .eq('id', versionId)
    .single()
  if (versionError || !version) return { error: versionError?.message ?? 'Versión no encontrada' }
  if (version.status !== 'draft') return { error: 'Solo se puede generar sobre una versión en borrador.' }

  const tradeId = (version as any).price_lists?.trade_id
  const { data: services, error: servicesError } = await supabase
    .from('services')
    .select('id, ut_coefficient, categories!inner(trade_id)')
    .eq('categories.trade_id', tradeId)
    .not('ut_coefficient', 'is', null)
  if (servicesError) return { error: servicesError.message }

  const rows = (services ?? []).map((s) => ({
    price_list_version_id: versionId,
    service_id: s.id,
    base_price: round2(s.ut_coefficient! * referenceUtValue),
  }))
  if (rows.length) {
    const { error } = await supabase
      .from('price_items')
      .upsert(rows, { onConflict: 'price_list_version_id,service_id' })
    if (error) return { error: error.message }
  }

  await supabase.from('price_list_versions').update({ reference_ut_value: referenceUtValue }).eq('id', versionId)
  await logAudit('price_list_versions', versionId, 'generate_from_ut', { referenceUtValue, count: rows.length })
  revalidatePath('/admin/listas')
  return { data: { count: rows.length } }
}
// Solo permitido si tiene precios cargados; una vez publicada, la DB la vuelve inmutable.
export async function publishVersion(versionId: string) {
  const supabase = await createClient()
  if (!items || items.length === 0) return { error: 'La versión no tiene precios cargados.' }

  const { error } = await supabase
    .from('price_list_versions')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', versionId)
  if (error) return { error: error.message }
  await logAudit('price_list_versions', versionId, 'publish', { items: items.length })
  revalidatePath('/admin/listas')
}

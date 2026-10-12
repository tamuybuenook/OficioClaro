'use server'

import { revalidatePath } from 'next/cache'
import { getAdminContext, cleanDbError } from '@/lib/auth/assert-admin'
import { mulRound2 } from '@/lib/money'

const PATHS = ['/admin/catalogo', '/admin']
const refresh = () => PATHS.forEach((p) => revalidatePath(p))

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function validDate(s: string) {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export async function createPriceList(tradeId: string, name: string) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  // Una lista por oficio (unique trade_id): si ya existe, se devuelve (idempotente).
  const { data: existing } = await ctx.supabase.from('price_lists').select('*').eq('trade_id', tradeId).maybeSingle()
  if (existing) return { data: existing }
  const { data, error } = await ctx.supabase.from('price_lists').insert({ trade_id: tradeId, name }).select().single()
  if (error) return { error: cleanDbError(error.message) }
  refresh()
  return { data }
}

// Crea una versión en borrador. Idempotente: repetir la operación devuelve la existente.
export async function createVersion(priceListId: string, formData: FormData) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const label = String(formData.get('version_label') ?? '').trim()
  const date = String(formData.get('effective_date') ?? '').trim()
  if (!label) return { error: 'El rótulo de la versión es obligatorio.' }
  if (!validDate(date)) return { error: 'La fecha de vigencia debe tener formato AAAA-MM-DD y ser válida.' }

  const { data, error } = await ctx.supabase.rpc('create_price_list_version', {
    p_price_list_id: priceListId, p_label: label, p_effective_date: date,
  })
  if (error) return { error: cleanDbError(error.message) }
  refresh()
  return { data: data as { id: string; created: boolean; status: string } }
}

// Copia los precios de una versión a otra en borrador. Idempotente: no pisa ni duplica ítems existentes.
export async function duplicateVersionItems(fromVersionId: string, toVersionId: string) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const { data: items, error: readError } = await ctx.supabase
    .from('price_items').select('service_id, base_price').eq('price_list_version_id', fromVersionId)
  if (readError) return { error: cleanDbError(readError.message) }
  if (!items?.length) return { data: { copied: 0 } }
  const rows = items.map((i) => ({ price_list_version_id: toVersionId, service_id: i.service_id, base_price: i.base_price }))
  const { error } = await ctx.supabase.from('price_items').upsert(rows, { onConflict: 'price_list_version_id,service_id', ignoreDuplicates: true })
  if (error) return { error: cleanDbError(error.message) }
  refresh()
  return { data: { copied: rows.length } }
}

// Carga/edita a mano el precio de un servicio en una versión BORRADOR (la base rechaza las publicadas).
export async function upsertPriceItem(versionId: string, serviceId: string, basePrice: number) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  if (!Number.isFinite(basePrice) || basePrice <= 0) return { error: 'El precio debe ser un número mayor a cero.' }
  const { data, error } = await ctx.supabase
    .from('price_items')
    .upsert({ price_list_version_id: versionId, service_id: serviceId, base_price: mulRound2(basePrice, 1) }, { onConflict: 'price_list_version_id,service_id' })
    .select().single()
  if (error) return { error: cleanDbError(error.message) }
  await ctx.supabase.from('audit_logs').insert({ actor_id: ctx.user.id, entity: 'price_items', entity_id: data.id, action: 'upsert', new_value: data })
  refresh()
  return { data }
}

// Genera (o recalcula) los precios de una versión BORRADOR = round(UT × valor UT maestro a la fecha de vigencia).
// Todo en una transacción de la base: precios + reference_ut_value (antes eran dos pasos y el segundo se perdía).
export async function generateItemsFromUt(versionId: string) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const { data, error } = await ctx.supabase.rpc('generate_version_items_from_ut', { p_version_id: versionId })
  if (error) return { error: cleanDbError(error.message) }
  refresh()
  return {
    data: data as { reference_ut_value: number; inserted: number; updated: number; unchanged: number; services_without_ut: number },
  }
}

export type VersionValidation = { errors: string[]; warnings: string[]; item_count: number; reference_ut_value: number | null; effective_date: string; status: string }

// Revisión previa a la publicación: validaciones + detalle de ítems con el precio esperado por UT.
export async function getVersionReview(versionId: string) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const { data: validation, error: vErr } = await ctx.supabase.rpc('validate_price_list_version', { p_version_id: versionId })
  if (vErr) return { error: cleanDbError(vErr.message) }

  const { data: version } = await ctx.supabase
    .from('price_list_versions').select('id, version_label, status, effective_date, reference_ut_value, source_ipc_id, published_at').eq('id', versionId).single()
  const { data: items, error } = await ctx.supabase
    .from('price_items').select('id, base_price, services(name, unit_label, ut_coefficient)').eq('price_list_version_id', versionId)
  if (error) return { error: cleanDbError(error.message) }

  const ref = (version as any)?.reference_ut_value as number | null
  const rows = (items ?? []).map((i: any) => {
    const coef: number | null = i.services?.ut_coefficient ?? null
    const expected = coef != null && ref != null && !(version as any)?.source_ipc_id ? mulRound2(coef, ref) : null
    return {
      id: i.id as string, name: i.services?.name as string, unit: i.services?.unit_label as string,
      ut: coef, price: Number(i.base_price), expected, differs: expected != null && Math.abs(expected - Number(i.base_price)) > 0.004,
    }
  }).sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return { data: { version, validation: validation as VersionValidation, items: rows } }
}

// Publicación: la validación y la inmutabilidad se aplican en la base (no se pueden eludir desde aquí).
export async function publishVersion(versionId: string) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const { data, error } = await ctx.supabase.rpc('publish_price_list_version', { p_version_id: versionId })
  if (error) return { error: cleanDbError(error.message) }
  refresh()
  return { data: data as VersionValidation }
}

// Descarta un borrador (p. ej. para rehacerlo desde UT). Los ítems quedan respaldados en audit_logs.
export async function discardDraftVersion(versionId: string) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const { data, error } = await ctx.supabase.rpc('discard_draft_version', { p_version_id: versionId })
  if (error) return { error: cleanDbError(error.message) }
  refresh()
  return { data: data as { discarded: string; items_backed_up: number } }
}

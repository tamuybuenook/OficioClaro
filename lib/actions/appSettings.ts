'use server'

import { revalidatePath } from 'next/cache'
import { getAdminContext, cleanDbError } from '@/lib/auth/assert-admin'
import { parsePolicyForm, settingsFromRows } from '@/lib/settings/policy'
import { PAYMENT_CONFIG_KEYS, MIGRATION_MISSING_MSG, parseBankForm, paymentConfigFromRows } from '@/lib/settings/payment-config'

// Solo admin (verificación explícita aquí + RLS en la base). Registra el cambio en audit_logs.
export async function updateSubscriptionPolicy(formData: FormData) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const parsed = parsePolicyForm(formData)
  if (!parsed.ok) return { error: parsed.error }

  const { supabase, user } = ctx
  const { data: before } = await supabase.from('app_settings').select('key, value')
  const old = settingsFromRows(before)
  const { noticeDays, graceDays } = parsed.value

  const a = await supabase.from('app_settings').update({ value: noticeDays }).eq('key', 'notice_days')
  if (a.error) return { error: cleanDbError(a.error.message) }
  const b = await supabase.from('app_settings').update({ value: graceDays }).eq('key', 'grace_days')
  if (b.error) return { error: `Se guardó el aviso previo pero falló la gracia: ${cleanDbError(b.error.message)}. Reintentá.` }

  await supabase.from('audit_logs').insert({ actor_id: user.id, entity: 'app_settings', entity_id: null, action: 'update_subscription_policy', old_value: old, new_value: parsed.value })
  revalidatePath('/admin/configuracion')
  return undefined
}

// Actualiza UNA fila existente de app_settings. Si la fila no existe (migración 0036 sin aplicar) no falla en silencio.
async function writeSetting(supabase: any, key: string, patch: { value: number; text_value?: string | null }): Promise<string | null> {
  const r = await supabase.from('app_settings').update(patch).eq('key', key).select('key')
  if (r.error) return cleanDbError(r.error.message)
  if (!Array.isArray(r.data) || r.data.length !== 1) return MIGRATION_MISSING_MSG
  return null
}

// Datos bancarios que ve el cliente al pagar por transferencia. Solo admin; se valida todo ANTES de escribir (y la base lo vuelve a validar).
export async function updateBankDetails(formData: FormData) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const parsed = parseBankForm(formData)
  if (!parsed.ok) return { error: parsed.error }

  const { supabase, user } = ctx
  const before = await supabase.from('app_settings').select('key, value, text_value').in('key', [...PAYMENT_CONFIG_KEYS])
  if (before.error) return { error: MIGRATION_MISSING_MSG }
  const old = paymentConfigFromRows(before.data)
  const { holder, cuit, cbu, alias } = parsed.value

  for (const [key, text] of [['bank_holder', holder], ['bank_cuit', cuit], ['bank_cbu', cbu], ['bank_alias', alias]] as const) {
    const err = await writeSetting(supabase, key, { value: 0, text_value: text })
    if (err) return { error: key === 'bank_holder' ? err : `Se guardó solo una parte de los datos bancarios (falló ${key}): ${err} Reintentá.` }
  }

  await supabase.from('audit_logs').insert({ actor_id: user.id, entity: 'app_settings', entity_id: null, action: 'update_bank_details', old_value: old.bank, new_value: parsed.value })
  revalidatePath('/admin/configuracion')
  revalidatePath('/')
  return undefined
}

// Oculta/muestra la sección de pago de Mercado Pago a los clientes. SOLO cambia la visibilidad:
// no toca credenciales de MP, suscripciones, webhooks ni el pago por transferencia.
export async function setMpHidden(formData: FormData) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const raw = formData.get('hidden')
  if (raw !== 'true' && raw !== 'false') return { error: 'Valor inválido.' }
  const hidden = raw === 'true'

  const { supabase, user } = ctx
  const before = await supabase.from('app_settings').select('key, value, text_value').in('key', [...PAYMENT_CONFIG_KEYS])
  if (before.error) return { error: MIGRATION_MISSING_MSG }
  const old = paymentConfigFromRows(before.data)

  const err = await writeSetting(supabase, 'mp_hidden', { value: hidden ? 1 : 0 })
  if (err) return { error: err }

  await supabase.from('audit_logs').insert({ actor_id: user.id, entity: 'app_settings', entity_id: null, action: 'set_mp_hidden', old_value: { mpHidden: old.mpHidden }, new_value: { mpHidden: hidden } })
  revalidatePath('/admin/configuracion')
  revalidatePath('/')
  return undefined
}

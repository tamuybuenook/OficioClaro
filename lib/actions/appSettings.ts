'use server'

import { revalidatePath } from 'next/cache'
import { getAdminContext, cleanDbError } from '@/lib/auth/assert-admin'
import { parsePolicyForm, settingsFromRows } from '@/lib/settings/policy'

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

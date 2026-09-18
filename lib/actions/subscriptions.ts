'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function logAudit(entity: string, entityId: string | null, action: string, newValue: unknown) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('audit_logs').insert({ actor_id: user?.id ?? null, entity, entity_id: entityId, action, new_value: newValue })
}

// El propio usuario puede arrancar su prueba gratuita (RLS lo permite solo con status 'trial').
// Duración configurable por plan (plans.trial_days), no hardcodeada (sección 12).
export async function startTrial(planId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: plan } = await supabase.from('plans').select('trial_days').eq('id', planId).single()
  const trialDays = plan?.trial_days ?? 30

  const start = new Date()
  const end = new Date(start)
  end.setDate(end.getDate() + trialDays)

  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      user_id: user.id,
      plan_id: planId,
      status: 'trial',
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
    })
    .select()
    .single()
  if (error) return { error: error.message }
  revalidatePath('/suscripcion')
  return { data }
}

// Solo admin: activar tras conciliar un pago, suspender, reactivar.
export async function setSubscriptionStatus(
  subscriptionId: string,
  status: 'active' | 'past_due' | 'suspended' | 'cancelled',
  newEndDate?: string,
) {
  const supabase = await createClient()
  const patch: Record<string, unknown> = { status }
  if (newEndDate) patch.end_date = newEndDate

  const { error } = await supabase.from('subscriptions').update(patch).eq('id', subscriptionId)
  if (error) return { error: error.message } // RLS rechaza si no es admin
  await logAudit('subscriptions', subscriptionId, 'status_change', patch)
  revalidatePath('/admin/suscripciones')
  revalidatePath('/suscripcion')
}

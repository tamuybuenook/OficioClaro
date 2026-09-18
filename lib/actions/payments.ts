'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function logAudit(entity: string, entityId: string | null, action: string, newValue: unknown) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('audit_logs').insert({ actor_id: user?.id ?? null, entity, entity_id: entityId, action, new_value: newValue })
}

// El usuario informa que hizo la transferencia. Queda "pending" hasta que admin concilie.
export async function reportTransferPayment(subscriptionId: string, formData: FormData) {
  const supabase = await createClient()
  const amount = Number(formData.get('amount'))
  const reference = String(formData.get('reference') ?? '') || null
  const proof_url = String(formData.get('proof_url') ?? '') || null

  const { data, error } = await supabase
    .from('payments')
    .insert({ subscription_id: subscriptionId, provider: 'transfer', amount, reference, proof_url, status: 'pending' })
    .select()
    .single()
  if (error) return { error: error.message }
  revalidatePath('/pagos')
  return { data }
}

function addBillingPeriod(date: Date, period: 'monthly' | 'yearly'): Date {
  const d = new Date(date)
  if (period === 'monthly') d.setMonth(d.getMonth() + 1)
  else d.setFullYear(d.getFullYear() + 1)
  return d
}

// Admin concilia: aprueba (activa/extiende la suscripción) o rechaza.
export async function reconcilePayment(paymentId: string, status: 'reconciled' | 'rejected', notes?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .select('*, subscriptions(id, end_date, plans(billing_period))')
    .eq('id', paymentId)
    .single()
  if (paymentError || !payment) return { error: paymentError?.message ?? 'Pago no encontrado' }

  const { error: updateError } = await supabase.from('payments').update({ status }).eq('id', paymentId)
  if (updateError) return { error: updateError.message } // RLS rechaza si no es admin

  await supabase.from('bank_reconciliations').insert({
    payment_id: paymentId,
    reconciled_by: user?.id ?? null,
    status,
    notes: notes ?? null,
  })

  if (status === 'reconciled') {
    const sub = (payment as any).subscriptions
    const currentEnd = sub?.end_date ? new Date(sub.end_date) : new Date()
    const base = currentEnd > new Date() ? currentEnd : new Date()
    const newEnd = addBillingPeriod(base, sub?.plans?.billing_period ?? 'monthly')

    await supabase
      .from('subscriptions')
      .update({ status: 'active', end_date: newEnd.toISOString().slice(0, 10) })
      .eq('id', sub.id)
  }

  await logAudit('payments', paymentId, 'reconcile', { status, notes })
  revalidatePath('/admin/conciliacion')
  revalidatePath('/suscripcion')
}

'use server'

import { createClient } from '@/lib/supabase/server'
import { getAdminContext, cleanDbError } from '@/lib/auth/assert-admin'
import { allow, RATE_MESSAGE } from '@/lib/rate-limit'
import { revalidatePath } from 'next/cache'

// El usuario informa que hizo la transferencia. Queda "pending" hasta que admin concilie.
export async function reportTransferPayment(subscriptionId: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const amount = Number(formData.get('amount'))
  const reference = String(formData.get('reference') ?? '').slice(0, 120) || null
  const proof_url = String(formData.get('proof_url') ?? '').slice(0, 500) || null
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return { error: 'Monto inválido.' }
  if (proof_url && !/^https?:\/\//i.test(proof_url)) return { error: 'El comprobante debe ser un enlace http(s).' }
  if (!(await allow(user.id, 'transfer'))) return { error: RATE_MESSAGE }

  const { data, error } = await supabase
    .from('payments')
    .insert({ subscription_id: subscriptionId, provider: 'transfer', amount, reference, proof_url, status: 'pending' })
    .select()
    .single()
  if (error) return { error: error.message }
  revalidatePath('/pagos')
  return { data }
}

// Admin concilia una TRANSFERENCIA. Todo ocurre en UNA transacción de PostgreSQL (reconcile_transfer_payment, 0025):
// cambio de estado + extensión + registro de conciliación + auditoría, con bloqueo de fila (sin doble extensión ni
// estados parciales). La base vuelve a verificar que quien llama es admin; acá se verifica antes por defensa en profundidad.
// Los pagos de Mercado Pago NO se concilian a mano: los resuelve el webhook (record_mp_payment).
export async function reconcilePayment(paymentId: string, status: 'reconciled' | 'rejected', notes?: string) {
  if (status !== 'reconciled' && status !== 'rejected') return { error: 'Estado inválido' }
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const { error } = await ctx.supabase.rpc('reconcile_transfer_payment', {
    p_payment_id: String(paymentId), p_status: status, p_notes: notes ? String(notes).slice(0, 500) : null,
  })
  if (error) return { error: cleanDbError(error.message) }
  revalidatePath('/admin/conciliacion')
  revalidatePath('/suscripcion')
}

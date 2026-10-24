'use server'

import { createClient } from '@/lib/supabase/server'
import { getAdminContext, cleanDbError } from '@/lib/auth/assert-admin'
import { allow, RATE_MESSAGE } from '@/lib/rate-limit'
import { revalidatePath } from 'next/cache'
import { MIN_REJECT_REASON, UUID_RE } from '@/lib/payments-rules'

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

// Admin concilia una TRANSFERENCIA. Todo ocurre en UNA transacción de PostgreSQL (reconcile_transfer_payment, 0025/0028/0032):
// cambio de estado + extensión + registro de conciliación + auditoría, con bloqueo de fila (sin doble extensión ni
// estados parciales). La base vuelve a verificar que quien llama es admin y que el pago sigue "pending"; acá se verifica
// antes por defensa en profundidad. Los pagos de Mercado Pago NO se concilian a mano: los resuelve el webhook.
//
// Reglas de esta capa (la base no las exige, la interfaz tampoco puede saltearlas):
//  - aprobar exige confirmFundsReceived === true: el admin declara que verificó el ingreso del dinero en el banco;
//  - rechazar exige un motivo (queda en bank_reconciliations.notes y en el historial).
export type ReconcileResult =
  | { ok: true; status: 'reconciled' | 'rejected'; endDate: string | null; error?: undefined }
  | { error: string; ok?: undefined }

export async function reconcilePayment(input: {
  paymentId: string
  decision: 'reconciled' | 'rejected'
  notes?: string
  confirmFundsReceived?: boolean
}): Promise<ReconcileResult> {
  const { paymentId, decision } = input
  if (decision !== 'reconciled' && decision !== 'rejected') return { error: 'Estado inválido' }
  if (typeof paymentId !== 'string' || !UUID_RE.test(paymentId)) return { error: 'Identificador de pago inválido.' }
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 500) : ''
  if (decision === 'reconciled' && input.confirmFundsReceived !== true) {
    return { error: 'Para aprobar tenés que confirmar que el dinero ingresó en la cuenta.' }
  }
  if (decision === 'rejected' && notes.length < MIN_REJECT_REASON) {
    return { error: `Escribí el motivo del rechazo (mínimo ${MIN_REJECT_REASON} caracteres).` }
  }

  const ctx = await getAdminContext()
  if (!ctx.supabase) return { error: ctx.error ?? 'No autorizado' }
  const { data, error } = await ctx.supabase.rpc('reconcile_transfer_payment', {
    p_payment_id: paymentId, p_status: decision, p_notes: notes || null,
  })
  if (error) return { error: cleanDbError(error.message) }

  revalidatePath('/admin/facturacion')
  revalidatePath(`/admin/facturacion/pagos/${paymentId}`)
  revalidatePath('/') // el usuario ve su suscripción en la página principal
  const endDate = data && typeof data === 'object' && typeof (data as { end_date?: unknown }).end_date === 'string' ? (data as { end_date: string }).end_date : null
  return { ok: true, status: decision, endDate }
}

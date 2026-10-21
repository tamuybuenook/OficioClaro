'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { getAdminContext, cleanDbError } from '@/lib/auth/assert-admin'
import { getMpConfig } from '@/lib/mercadopago/config'
import { createMpClient, type MpClient } from '@/lib/mercadopago/client'
import { createSupabaseMpStore } from '@/lib/mercadopago/store'
import { abortUserDeletion, prepareUserDeletion, unavailableMp, windDownSubscription } from '@/lib/mercadopago/lifecycle'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES = ['trial', 'active', 'suspended', 'cancelled']
const NO_SERVICE_KEY = 'Falta configurar SUPABASE_SERVICE_ROLE_KEY para operar sobre renovaciones de Mercado Pago.'

// Dependencias de Mercado Pago para operaciones administrativas. Si MP no está configurado, las cancelaciones quedan
// "sin confirmar" (seguimiento + reintento); nunca se dan por hechas.
function mpDeps() {
  const store = createSupabaseMpStore(createAdminClient())
  let mp: MpClient = unavailableMp
  try { mp = createMpClient(getMpConfig()) } catch { console.error('[mp] configuración incompleta (operación administrativa)') }
  return { store, mp }
}

// Admin asigna/cambia el plan de un usuario a mano (upsert: si no tiene suscripción, crea una).
// Suspender o cancelar con una renovación activa en Mercado Pago: el estado local y el seguimiento de la autorización se
// aplican juntos; después se cancela en MP y se confirma. Si MP no confirma, el estado local queda aplicado y se devuelve
// un aviso (la cancelación sigue pendiente y se reintenta). Nunca se muestra como cancelada una autorización sin confirmar.
export async function adminSetUserPlan(userId: string, planId: string, status: 'trial' | 'active' | 'suspended' | 'cancelled'): Promise<{ error?: string; warning?: string } | void> {
  if (!UUID.test(String(userId)) || !UUID.test(String(planId)) || !STATUSES.includes(status)) return { error: 'Datos inválidos.' }
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const supabase = ctx.supabase

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing && (status === 'suspended' || status === 'cancelled')) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: NO_SERVICE_KEY }
    try {
      const res = await windDownSubscription(mpDeps(), { subscriptionId: existing.id, status, planId, actorId: ctx.user.id })
      revalidatePath('/admin/usuarios')
      if (!res.allConfirmed) {
        return { warning: 'El estado se aplicó, pero Mercado Pago no confirmó la cancelación de la renovación automática. Quedó registrada y se reintentará; mientras tanto no se acreditan cobros nuevos de esa cuenta.' }
      }
      return
    } catch (e) {
      console.error('[mp] wind-down', (e as Error)?.message)
      return { error: cleanDbError((e as Error)?.message ?? 'No se pudo completar la operación.') }
    }
  }

  if (existing) {
    const { error } = await supabase.from('subscriptions').update({ plan_id: planId, status }).eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('subscriptions').insert({ user_id: userId, plan_id: planId, status })
    if (error) return { error: error.message }
  }
  revalidatePath('/admin/usuarios')
}

export async function updateUser(userId: string, formData: FormData) {
  const supabase = await createClient()
  const patch = {
    full_name: String(formData.get('full_name') ?? ''),
    role: String(formData.get('role') ?? 'user'),
  }
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
  if (error) return { error: error.message }
  revalidatePath('/admin/usuarios')
}

// Requiere SUPABASE_SERVICE_ROLE_KEY configurada (borra la cuenta de auth por completo).
// Si el usuario tiene renovaciones en Mercado Pago, primero se cancelan y CONFIRMAN; si no se confirma (o hay cobros retenidos
// sin resolver) no se borra nada, para conservar el ledger que identifica la autorización y poder reintentar.
export async function deleteUser(userId: string): Promise<{ error?: string } | void> {
  if (!UUID.test(String(userId))) return { error: 'Datos inválidos.' }
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY para poder borrar usuarios.' }
  }
  const deps = mpDeps()
  try {
    const check = await prepareUserDeletion(deps, { userId, actorId: ctx.user.id })
    if (!check.ok) return { error: check.detail }
  } catch (e) {
    console.error('[mp] delete-user', (e as Error)?.message)
    return { error: 'No se pudo verificar el estado de las renovaciones. No se eliminó nada.' }
  }
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    // El borrado falló (p.ej. la guardia de la base por una autorización abierta): se libera la retención para que la cuenta siga operando.
    await abortUserDeletion(deps, userId)
    if (/ledger_busy/.test(error.message)) return { error: 'Otra operación estaba actualizando las renovaciones de esta cuenta. No se eliminó nada; volvé a intentarlo en unos segundos.' }
    return { error: error.message }
  }
  revalidatePath('/admin/usuarios')
}

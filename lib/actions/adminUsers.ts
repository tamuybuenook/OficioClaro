'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

// Admin asigna/cambia el plan de un usuario a mano (upsert: si no tiene suscripción, crea una).
export async function adminSetUserPlan(userId: string, planId: string, status: 'trial' | 'active' | 'suspended' | 'cancelled') {
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

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
export async function deleteUser(userId: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY para poder borrar usuarios.' }
  }
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return { error: error.message }
  revalidatePath('/admin/usuarios')
}

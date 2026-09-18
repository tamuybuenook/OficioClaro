'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateMyProfile(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const patch = {
    full_name: String(formData.get('full_name') ?? ''),
    phone: String(formData.get('phone') ?? '') || null,
    cuit: String(formData.get('cuit') ?? '') || null,
    address: String(formData.get('address') ?? '') || null,
    city: String(formData.get('city') ?? '') || null,
    province: String(formData.get('province') ?? '') || null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
  if (error) return { error: error.message }
  revalidatePath('/perfil')
}

// Datos de cobro (sección 14): el profesional los guarda para compartirlos con sus clientes.
// No es una integración bancaria ni procesa pagos.
export async function updateMyPaymentDetails(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const patch = {
    user_id: user.id,
    bank: String(formData.get('bank') ?? '') || null,
    alias: String(formData.get('alias') ?? '') || null,
    cbu: String(formData.get('cbu') ?? '') || null,
    account_holder: String(formData.get('account_holder') ?? '') || null,
    holder_cuit: String(formData.get('holder_cuit') ?? '') || null,
    mercado_pago_alias: String(formData.get('mercado_pago_alias') ?? '') || null,
    notes: String(formData.get('notes') ?? '') || null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from('payment_details').upsert(patch, { onConflict: 'user_id' })
  if (error) return { error: error.message }
  revalidatePath('/perfil')
}

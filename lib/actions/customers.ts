'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createCustomer(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data, error } = await supabase
    .from('customers')
    .insert({
      user_id: user.id,
      name: String(formData.get('name')),
      phone: String(formData.get('phone') ?? '') || null,
      email: String(formData.get('email') ?? '') || null,
      address: String(formData.get('address') ?? '') || null,
      notes: String(formData.get('notes') ?? '') || null,
    })
    .select()
    .single()
  if (error) return { error: error.message }
  revalidatePath('/clientes')
  return { data }
}

export async function updateCustomer(id: string, formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('customers')
    .update({
      name: String(formData.get('name')),
      phone: String(formData.get('phone') ?? '') || null,
      email: String(formData.get('email') ?? '') || null,
      address: String(formData.get('address') ?? '') || null,
      notes: String(formData.get('notes') ?? '') || null,
    })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/clientes')
}

export async function deleteCustomer(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/clientes')
}

'use server'

import { createClient } from '@/lib/supabase/server'
import { getClientDetail } from '@/lib/services/clientDetail'
import { revalidatePath } from 'next/cache'

export async function fetchClientDetail(customerId: string) {
  return getClientDetail(customerId)
}

async function logActivity(customerId: string, type: string, description?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('client_activity').insert({ user_id: user.id, customer_id: customerId, type, description })
}

export async function addClientJob(customerId: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const patch = {
    user_id: user.id,
    customer_id: customerId,
    job_date: String(formData.get('job_date') || new Date().toISOString().slice(0, 10)),
    description: String(formData.get('description')),
    price: formData.get('price') ? Number(formData.get('price')) : null,
    notes: String(formData.get('notes') ?? '') || null,
  }
  const { error } = await supabase.from('client_jobs').insert(patch)
  if (error) return { error: error.message }
  await logActivity(customerId, 'trabajo_realizado', patch.description)
  revalidatePath('/clientes')
}

export async function addClientNote(customerId: string, note: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { error } = await supabase.from('client_notes').insert({ user_id: user.id, customer_id: customerId, note })
  if (error) return { error: error.message }
  revalidatePath('/clientes')
}

export async function setClientRating(customerId: string, rating: number, ratingNote: string | null) {
  const supabase = await createClient()
  const { error } = await supabase.from('customers').update({ rating, rating_note: ratingNote }).eq('id', customerId)
  if (error) return { error: error.message }
  revalidatePath('/clientes')
}

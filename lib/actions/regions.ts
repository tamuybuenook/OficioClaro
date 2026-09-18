'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function logAudit(entity: string, entityId: string | null, action: string, newValue: unknown) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('audit_logs').insert({ actor_id: user?.id ?? null, entity, entity_id: entityId, action, new_value: newValue })
}

export async function createRegion(formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const adjustment_percent = Number(formData.get('adjustment_percent'))

  const { data, error } = await supabase.from('regions').insert({ name, adjustment_percent }).select().single()
  if (error) return { error: error.message }
  await logAudit('regions', data.id, 'create', data)
  revalidatePath('/admin/zonas')
  return { data }
}

export async function updateRegion(id: string, formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name'))
  const adjustment_percent = Number(formData.get('adjustment_percent'))

  const { error } = await supabase.from('regions').update({ name, adjustment_percent }).eq('id', id)
  if (error) return { error: error.message }
  await logAudit('regions', id, 'update', { name, adjustment_percent })
  revalidatePath('/admin/zonas')
}

export async function deleteRegion(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('regions').delete().eq('id', id)
  if (error) return { error: error.message } // falla si hay profiles usando la zona (fk sin cascade)
  await logAudit('regions', id, 'delete', null)
  revalidatePath('/admin/zonas')
}

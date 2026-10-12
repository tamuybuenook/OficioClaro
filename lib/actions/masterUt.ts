'use server'

import { revalidatePath } from 'next/cache'
import { getAdminContext, cleanDbError } from '@/lib/auth/assert-admin'

export async function setMasterUtValue(value: number, note?: string) {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  if (!Number.isFinite(value) || value <= 0) return { error: 'El valor de UT debe ser un número mayor a cero.' }
  const { error } = await ctx.supabase.rpc('set_master_ut_value', { p_value: value, p_note: note ?? null })
  if (error) return { error: cleanDbError(error.message) }
  revalidatePath('/admin/catalogo')
  revalidatePath('/')
  return { data: { value } }
}

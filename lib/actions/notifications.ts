'use server'

import { createClient } from '@/lib/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Descarta un aviso informativo del usuario logueado. La base verifica dueño y tipo (solo «pago confirmado»). */
export async function dismissNotification(id: string): Promise<{ ok: boolean }> {
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('dismiss_notification', { p_id: id })
  if (error) return { ok: false }
  return { ok: data === true }
}

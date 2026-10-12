import { createClient } from '@/lib/supabase/server'

export async function getMasterUtCurrent(): Promise<number | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_master_ut_at', { p_date: new Date().toISOString().slice(0, 10) })
  return data ?? null
}

export async function getMasterUtHistory() {
  const supabase = await createClient()
  const { data } = await supabase.from('master_ut_history').select('*').order('valid_from', { ascending: false })
  return data ?? []
}

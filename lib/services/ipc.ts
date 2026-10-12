import { createClient } from '@/lib/supabase/server'

export { targetEffectiveDate } from '@/lib/ipc-dates'

export async function getIpcIndexes() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('ipc_indexes').select('*').order('year', { ascending: false }).order('month', { ascending: false })
  if (error) throw error
  return data
}

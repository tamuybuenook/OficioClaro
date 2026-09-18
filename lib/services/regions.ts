import { createClient } from '@/lib/supabase/server'

export async function getRegions() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('regions').select('*').order('name')
  if (error) throw error
  return data
}

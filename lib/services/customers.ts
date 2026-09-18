import { createClient } from '@/lib/supabase/server'

export async function getMyCustomers() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('customers').select('*').order('name')
  if (error) throw error
  return data
}

import { createClient } from '@/lib/supabase/server'

export async function getMyPayments() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payments')
    .select('*, subscriptions(plan_id, plans(name))')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// Solo admin (RLS lo filtra igual, esto es para el panel de conciliación).
export async function getPendingPayments() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payments')
    .select('*, subscriptions(user_id, plan_id, plans(name, price), profiles(full_name))')
    .eq('status', 'pending')
    .order('created_at')
  if (error) throw error
  return data
}

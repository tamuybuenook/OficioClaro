import { createClient } from '@/lib/supabase/server'

export async function getClientDetail(customerId: string) {
  const supabase = await createClient()

  const [{ data: customer }, { data: jobs }, { data: quotes }, { data: activity }, { data: notes }, { data: appliances }] = await Promise.all([
    supabase.from('customers').select('*').eq('id', customerId).single(),
    supabase.from('client_jobs').select('*, trades(name)').eq('customer_id', customerId).order('job_date', { ascending: false }),
    supabase.from('quotes').select('id, number, status, total, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }),
    supabase.from('client_activity').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(20),
    supabase.from('client_notes').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
    supabase.from('appliances').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
  ])

  return {
    customer,
    jobs: jobs ?? [],
    quotes: quotes ?? [],
    activity: activity ?? [],
    notes: notes ?? [],
    appliances: appliances ?? [],
  }
}

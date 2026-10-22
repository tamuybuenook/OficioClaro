import { createClient } from '@/lib/supabase/server'

export async function getActivePlans() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('plans').select('*').eq('is_active', true).order('price')
  if (error) throw error
  return data
}

export async function getMySubscription() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, plans!plan_id(*)') // subscriptions tiene dos claves hacia plans (plan_id y mp_plan_id): sin la pista, PostgREST responde «ambiguo»
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

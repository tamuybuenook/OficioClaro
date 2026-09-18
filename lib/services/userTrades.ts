import { createClient } from '@/lib/supabase/server'

export async function getMyEnabledTradeIds(userId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('user_trades').select('trade_id').eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((r) => r.trade_id)
}

// null = sin límite (plan Full o sin límite configurado). 0 = sin suscripción activa/trial.
export async function getMyTradeLimit(userId: string): Promise<number | null> {
  const supabase = await createClient()
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, plans(max_trades)')
    .eq('user_id', userId)
    .in('status', ['trial', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!sub) return 0
  return (sub as any).plans?.max_trades ?? null
}

import { createClient } from '@/lib/supabase/server'

// Pagos de la suscripción del usuario autenticado. Se filtra por dueño de forma EXPLÍCITA (además de la RLS): la política
// `payments_own_read` también deja leer todo a un administrador, y un admin que usa su panel de usuario no debe ver pagos ajenos.
export async function getMyPayments() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('payments')
    .select('*, plan:plans!plan_id(name), subscriptions!inner(user_id, plan_id, plans!plan_id(name))')
    .eq('subscriptions.user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data
}

// Solo admin (RLS lo filtra igual, esto es para el panel de conciliación).
export async function getPendingPayments() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payments')
    .select('*, subscriptions(user_id, plan_id, plans!plan_id(name, price), profiles(full_name))')
    .eq('status', 'pending')
    .order('created_at')
  if (error) throw error
  return data
}

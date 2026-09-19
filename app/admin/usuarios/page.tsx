import { createClient } from '@/lib/supabase/server'
import { UsuariosPanel } from '@/components/admin/usuarios-panel'

export default async function UsuariosPage() {
  const supabase = await createClient()
  const [{ data: users }, { data: plans }, { data: subs }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, role, created_at').order('created_at', { ascending: false }).limit(200),
    supabase.from('plans').select('id, name').order('price'),
    supabase.from('subscriptions').select('user_id, plan_id, status').order('created_at', { ascending: false }),
  ])

  // última suscripción por usuario
  const subByUser = new Map<string, { plan_id: string; status: string }>()
  for (const s of subs ?? []) if (!subByUser.has(s.user_id)) subByUser.set(s.user_id, s)

  return (
    <div>
      <p className="text-sm text-[var(--oc-muted)]"><a href="/admin" className="hover:underline">Admin</a> &gt; Usuarios</p>
      <h1 className="mt-1 text-2xl font-bold">Usuarios ({users?.length ?? 0})</h1>
      <UsuariosPanel
        users={(users ?? []).map((u) => ({ ...u, subscription: subByUser.get(u.id) ?? null }))}
        plans={plans ?? []}
      />
    </div>
  )
}

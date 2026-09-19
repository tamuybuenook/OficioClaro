import { createClient } from '@/lib/supabase/server'

export default async function SuscripcionesPage() {
  const supabase = await createClient()
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('id, status, start_date, end_date, plans(name), profiles(full_name)')
    .order('start_date', { ascending: false })
    .limit(100)

  return (
    <div>
      <p className="text-sm text-[var(--oc-muted)]"><a href="/admin" className="hover:underline">Admin</a> &gt; Suscripciones</p>
      <h1 className="mt-1 text-2xl font-bold">Suscripciones</h1>
      <p className="mt-1 text-xs text-[var(--oc-muted)]">Vista de lectura. Conciliación y cambios de estado: en desarrollo.</p>
      <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)]">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead><tr className="border-b border-[var(--oc-border-soft)] text-xs text-[var(--oc-muted)]"><th className="p-3">Usuario</th><th>Plan</th><th>Estado</th><th>Desde</th><th>Hasta</th></tr></thead>
          <tbody>
            {(subs ?? []).map((s: any) => (
              <tr key={s.id} className="border-b border-[var(--oc-border-soft)] last:border-0">
                <td className="p-3">{s.profiles?.full_name ?? '—'}</td>
                <td>{s.plans?.name ?? '—'}</td>
                <td>{s.status}</td>
                <td>{s.start_date}</td>
                <td>{s.end_date ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

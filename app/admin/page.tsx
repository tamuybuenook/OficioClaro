import { createClient } from '@/lib/supabase/server'
import { Users, Banknote, Layers, Wrench, Check, ChevronRight } from 'lucide-react'

function timeAgo(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'Recién'
  if (min < 60) return `Hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `Hace ${h} h`
  return `Hace ${Math.floor(h / 24)} d`
}

function initials(name: string | null) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('') || '?'
}

const actionLabel: Record<string, string> = {
  create: 'Creó un registro',
  update: 'Actualizó un registro',
  delete: 'Borró un registro',
  publish: 'Publicó una versión',
  apply: 'Aplicó una actualización',
  reconcile: 'Concilió un pago',
  status_change: 'Cambió un estado',
  bulk_upsert: 'Cargó datos por lote',
}

export default async function AdminHome() {
  const supabase = await createClient()

  const [{ count: users }, { count: activeSubs }, { count: pendingPayments }, { count: trades }, { count: draftVersions }, { count: pendingIpc }, { data: activity }] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('subscriptions').select('id', { count: 'exact', head: true }).in('status', ['trial', 'active']),
    supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('trades').select('id', { count: 'exact', head: true }),
    supabase.from('price_list_versions').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('ipc_indexes').select('id', { count: 'exact', head: true }).neq('status', 'applied'),
    supabase.from('audit_logs').select('id, action, entity, created_at, profiles(full_name)').order('created_at', { ascending: false }).limit(5),
  ])

  const stats = [
    ['Usuarios', users ?? 0, Users],
    ['Pagos pendientes', pendingPayments ?? 0, Banknote],
    ['Suscripciones activas', activeSubs ?? 0, Layers],
    ['Oficios cargados', trades ?? 0, Wrench],
  ] as const

  const tasks = [
    { label: 'Conciliar pagos pendientes', detail: `${pendingPayments ?? 0} pago(s)`, href: '/admin/suscripciones' },
    { label: 'Publicar listas en borrador', detail: `${draftVersions ?? 0} versión(es)`, href: '/admin/catalogo' },
    { label: 'Aplicar IPC cargado', detail: `${pendingIpc ?? 0} pendiente(s)`, href: '/admin/ipc' },
  ]

  return (
    <div>
      <p className="text-sm text-[var(--oc-muted)]">Administración</p>
      <h1 className="mt-1 text-2xl font-bold">Panel general</h1>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([label, value, Icon]) => (
          <div key={label} className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4">
            <Icon className="size-5 text-[var(--oc-brand)]" />
            <p className="mt-5 text-xs text-[var(--oc-muted)]">{label}</p>
            <p className="mt-1 text-xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
          <h2 className="font-bold">Actividad reciente</h2>
          <div className="mt-4 flex flex-col gap-4">
            {(activity ?? []).length === 0 && <p className="text-sm text-[var(--oc-muted)]">Sin actividad registrada todavía.</p>}
            {(activity ?? []).map((a: any) => (
              <div key={a.id} className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-[var(--oc-brand-soft)] text-xs font-bold text-[var(--oc-brand)]">{initials(a.profiles?.full_name)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.profiles?.full_name ?? 'Sistema'}</p>
                  <p className="text-xs text-[var(--oc-muted)]">{actionLabel[a.action] ?? a.action} · {a.entity}</p>
                </div>
                <span className="shrink-0 text-[11px] text-[var(--oc-muted)]">{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
          <h2 className="font-bold">Tareas para hoy</h2>
          <div className="mt-4 flex flex-col gap-3">
            {tasks.map((t) => (
              <a key={t.label} href={t.href} className="flex items-center gap-3 rounded-xl bg-[var(--oc-surface-muted)] p-3 hover:bg-[var(--oc-surface-soft)]">
                <div className="flex size-9 items-center justify-center rounded-lg bg-[var(--oc-surface)] text-[var(--oc-brand)]"><Check className="size-4" /></div>
                <div className="flex-1"><p className="text-sm font-semibold">{t.label}</p><p className="text-xs text-[var(--oc-muted)]">{t.detail}</p></div>
                <ChevronRight className="size-4 text-[var(--oc-muted)]" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

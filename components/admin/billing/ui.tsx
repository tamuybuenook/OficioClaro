// Piezas visuales (componentes de servidor, sin JS de cliente) del panel de facturación.
import { Badge } from '@/components/ui/badge'
import { CATEGORY_LABEL, CATEGORY_TONE, PROVIDER_LABEL, classifyPayment, type Category, type PaymentFacts } from '@/lib/admin/billing/classify'
import { PAGE_SIZE, filtersToQuery, type BillingFilters } from '@/lib/admin/billing/filters'

export const card = 'rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)]'
export const th = 'p-3 text-xs font-semibold text-[var(--oc-muted)] whitespace-nowrap'
export const td = 'p-3 align-top'
export const inputCls = 'w-full rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-3 py-2 text-sm text-[var(--oc-ink)]'
export const btnCls = 'inline-flex items-center justify-center rounded-xl bg-[var(--oc-brand)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90'
export const btnGhost = 'inline-flex items-center justify-center rounded-xl border border-[var(--oc-border)] px-4 py-2 text-sm font-semibold text-[var(--oc-ink)] hover:bg-[var(--oc-surface-soft)]'

export function CategoryBadge({ p }: { p: PaymentFacts }) {
  const c = classifyPayment(p)
  return <Badge tone={CATEGORY_TONE[c]}>{CATEGORY_LABEL[c]}</Badge>
}
export const providerLabel = (p: string) => PROVIDER_LABEL[p] ?? p

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <p className="text-sm text-[var(--oc-muted)]">
      {items.map((it, i) => (
        <span key={i}>{i > 0 && ' > '}{it.href ? <a href={it.href} className="hover:underline">{it.label}</a> : it.label}</span>
      ))}
    </p>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className={`${card} p-4 ${tone === 'warn' ? 'border-[var(--oc-warning-text)]/40' : ''}`}>
      <p className="text-xs text-[var(--oc-muted)]">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--oc-muted)]">{sub}</p>}
    </div>
  )
}

export function KeyValue({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-[var(--oc-muted)]">{k}</dt>
          <dd className="mt-0.5 break-words text-sm font-medium">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <span className="break-all font-mono text-xs">{children}</span>
}

export function Pagination({ page, total, base, f }: { page: number; total: number; base: string; f: BillingFilters }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const href = (p: number) => `${base}${filtersToQuery(f, { pagina: p > 1 ? p : null })}`
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-xs text-[var(--oc-muted)]">{total === 0 ? 'Sin resultados' : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} de ${total}`}</p>
      <div className="flex items-center gap-2">
        {page > 1 ? <a href={href(page - 1)} className={btnGhost}>Anterior</a> : <span className={`${btnGhost} pointer-events-none opacity-40`}>Anterior</span>}
        <span className="text-xs text-[var(--oc-muted)]">Página {page} de {pages}</span>
        {page < pages ? <a href={href(page + 1)} className={btnGhost}>Siguiente</a> : <span className={`${btnGhost} pointer-events-none opacity-40`}>Siguiente</span>}
      </div>
    </div>
  )
}

export function EmptyRow({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <tr><td colSpan={cols} className="p-6 text-center text-sm text-[var(--oc-muted)]">{children}</td></tr>
}

export const OUTCOME_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'blue'> = { processed: 'success', duplicate: 'neutral', ignored: 'neutral', rejected: 'warning', error: 'warning' }
export const OUTCOME_LABEL: Record<string, string> = { processed: 'Procesado', duplicate: 'Duplicado', ignored: 'Ignorado', rejected: 'Rechazado', error: 'Error' }
export function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <Badge tone="blue">Recibido</Badge>
  return <Badge tone={OUTCOME_TONE[outcome] ?? 'neutral'}>{OUTCOME_LABEL[outcome] ?? outcome}</Badge>
}

export const SUB_STATE_LABEL: Record<string, string> = { trial: 'En prueba', active: 'Activa', past_due: 'Cobro fallido (con acceso)', cancelled: 'Sin renovar (con acceso)', expired: 'Vencida', suspended: 'Suspendida', none: 'Sin suscripción' }
export const PRE_STATUS_LABEL: Record<string, string> = { creating: 'Creándose', pending: 'Pendiente de autorizar', authorized: 'Autorizada', paused: 'Pausada', cancelling: 'Cancelándose (sin confirmar)', cancelled: 'Cancelada', failed: 'Fallida' }
export const INCIDENT_LABEL: Record<string, string> = {
  mp_incident_cancel_unconfirmed: 'Cancelación en MP sin confirmar',
  mp_incident_attach_failed: 'Autorización creada en MP pero no guardada',
  mp_incident_replaced_still_alive: 'Autorización reemplazada que sigue viva en MP',
  mp_incident_unknown_preapproval_charge: 'Cobro de una autorización desconocida',
  mp_incident_payment_held: 'Cobro retenido (suscripción suspendida o cancelada)',
  mp_incident_payment_without_local_record: 'Pago de MP sin registro local',
}
export const incidentLabel = (a: string) => INCIDENT_LABEL[a] ?? a

export type { Category }

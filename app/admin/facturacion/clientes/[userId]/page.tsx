import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/require-admin'
import { fetchClientDetail } from '@/lib/admin/billing/queries'
import { fetchUserEmail } from '@/lib/admin/billing/user-email'
import { PAGE_SIZE } from '@/lib/admin/billing/filters'
import { classifyPayment } from '@/lib/admin/billing/classify'
import { formatArs, formatDateAr, formatDateTimeAr } from '@/lib/admin/billing/format'
import { displayState } from '@/lib/subscription-access'
import { Badge } from '@/components/ui/badge'
import { CategoryBadge, Crumbs, EmptyRow, KeyValue, Mono, OutcomeBadge, PRE_STATUS_LABEL, SUB_STATE_LABEL, btnGhost, card, incidentLabel, providerLabel, td, th } from '@/components/admin/billing/ui'
import { periodAdjective } from '@/lib/plan-period'

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ClienteDetallePage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ pagina?: string }> }) {
  const { supabase } = await requireAdmin()
  const { userId } = await params
  if (!UUID_RE.test(userId)) notFound()
  const pageN = Number.parseInt((await searchParams).pagina ?? '1', 10)
  const page = Number.isFinite(pageN) ? Math.min(Math.max(pageN, 1), 10_000) : 1
  const [d, email] = await Promise.all([fetchClientDetail(supabase, userId, page), fetchUserEmail(userId)])
  if (!d) notFound()
  const current = d.subscriptions[0]
  const state = displayState(current ?? null)
  const openPre = d.preapprovals.find((x: any) => ['creating', 'pending', 'authorized', 'paused', 'cancelling'].includes(x.status))
  const flagged = d.payments.filter((p: any) => ['retenido', 'reembolso_pendiente', 'reembolsado', 'sin_aplicar'].includes(classifyPayment(p)))
  const pages = Math.max(1, Math.ceil(d.total / PAGE_SIZE))

  return (
    <div className="max-w-6xl">
      <Crumbs items={[{ href: '/admin', label: 'Admin' }, { href: '/admin/facturacion', label: 'Facturación' }, { label: 'Cliente' }]} />
      <h1 className="mt-1 text-2xl font-bold">{d.profile.full_name ?? 'Usuario sin nombre'}</h1>

      <div className={`${card} mt-5 p-5`}>
        <h2 className="mb-4 font-bold">Datos del usuario</h2>
        <KeyValue rows={[
          ['Nombre', d.profile.full_name ?? '—'], ['Email', email ?? 'No disponible'], ['Teléfono', d.profile.phone ?? '—'],
          ['Rol', d.profile.role], ['Alta', formatDateAr(d.profile.created_at)], ['Identificador', <Mono key="i">{d.profile.id}</Mono>],
        ]} />
      </div>

      <div className={`${card} mt-4 p-5`}>
        <h2 className="mb-4 font-bold">Plan y suscripción actual</h2>
        {!current ? <p className="text-sm text-[var(--oc-muted)]">Sin suscripción.</p> : (
          <KeyValue rows={[
            ['Plan', current.plans ? `${current.plans.name} · ${formatArs(current.plans.price)} (${periodAdjective(current.plans.billing_period)})` : '—'],
            ['Estado', <Badge key="s" tone={state === 'active' || state === 'trial' ? 'success' : state === 'expired' || state === 'suspended' ? 'neutral' : 'warning'}>{SUB_STATE_LABEL[state]}</Badge>],
            ['Inicio', formatDateAr(current.start_date)], ['Vencimiento', formatDateAr(current.end_date)],
            ['Cancelada el', current.cancelled_at ? formatDateTimeAr(current.cancelled_at) : '—'],
            ['Prueba a la espera de verificar email', current.trial_pending ? 'Sí' : 'No'],
          ]} />
        )}
        {d.subscriptions.length > 1 && <p className="mt-3 text-xs text-[var(--oc-muted)]">{d.subscriptions.length} suscripciones en total (se muestra la más reciente; los pagos de todas están en el historial).</p>}
      </div>

      <div className={`${card} mt-4 p-5`}>
        <h2 className="mb-4 font-bold">Autorización de renovación automática</h2>
        {d.preapprovals.length === 0 ? <p className="text-sm text-[var(--oc-muted)]">Nunca autorizó una renovación automática.</p> : (
          <>
            <p className="mb-3 text-sm">{openPre ? <>Vigente: <Badge tone={openPre.status === 'authorized' ? 'success' : 'warning'}>{PRE_STATUS_LABEL[openPre.status] ?? openPre.status}</Badge> · {formatArs(openPre.amount)} · MP <Mono>{openPre.preapproval_id ?? '—'}</Mono></> : 'No tiene una autorización abierta.'}</p>
            <ul className="flex flex-col gap-2 text-sm">
              {d.preapprovals.map((x: any) => (
                <li key={x.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--oc-border-soft)] pb-2 last:border-0">
                  <span className="font-medium">{PRE_STATUS_LABEL[x.status] ?? x.status}</span>
                  <span className="text-xs text-[var(--oc-muted)]">{formatArs(x.amount)} · {formatDateTimeAr(x.created_at)}{x.closed_at ? ` → ${formatDateTimeAr(x.closed_at)}` : ''}</span>
                  {x.status === 'cancelling' && <span className="text-xs text-[var(--oc-warning-text)]">{x.cancel_attempts} intento(s) de cancelar sin confirmar</span>}
                  {x.last_error && <span className="w-full text-xs text-[var(--oc-warning-text)]">Último error: {x.last_error}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {(flagged.length > 0 || d.incidents.length > 0 || d.webhookProblems.length > 0) && (
        <div className={`${card} mt-4 border-[var(--oc-warning-text)]/40 p-5`}>
          <h2 className="mb-3 font-bold">Para revisar</h2>
          {flagged.length > 0 && (
            <ul className="mb-3 flex flex-col gap-2 text-sm">
              {flagged.map((p: any) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3"><CategoryBadge p={p} /><span>{formatArs(p.amount)} · {formatDateAr(p.created_at)}</span><a className="text-[var(--oc-brand)] hover:underline" href={`/admin/facturacion/pagos/${p.id}`}>Ver pago</a></li>
              ))}
            </ul>
          )}
          {d.incidents.length > 0 && (
            <ul className="mb-3 flex flex-col gap-2 text-sm">{d.incidents.map((i) => <li key={i.id}><span className="font-medium">{incidentLabel(i.action)}</span> <span className="text-xs text-[var(--oc-muted)]">· {formatDateTimeAr(i.created_at)}</span></li>)}</ul>
          )}
          {d.webhookProblems.length > 0 && (
            <ul className="flex flex-col gap-2 text-sm">{d.webhookProblems.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-2"><OutcomeBadge outcome={e.outcome} /><Mono>{e.data_id}</Mono><span className="text-xs text-[var(--oc-muted)]">{formatDateTimeAr(e.received_at)}{e.detail ? ` · ${e.detail}` : ''}</span></li>)}</ul>
          )}
          <p className="mt-3 text-xs text-[var(--oc-muted)]">Lo de arriba proviene de la página actual del historial y de los registros del cliente.</p>
        </div>
      )}

      <h2 className="mt-8 text-lg font-bold">Historial de pagos ({d.total})</h2>
      <div className={`${card} mt-3 overflow-x-auto`}>
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead><tr className="border-b border-[var(--oc-border-soft)]"><th className={th}>Fecha</th><th className={th}>Medio</th><th className={th}>Plan</th><th className={th}>Importe</th><th className={th}>Estado</th><th className={th}>Aplicado</th><th className={th}>Período cubierto</th><th className={th}></th></tr></thead>
          <tbody>
            {d.payments.length === 0 && <EmptyRow cols={8}>Sin pagos.</EmptyRow>}
            {d.payments.map((p: any) => (
              <tr key={p.id} className="border-b border-[var(--oc-border-soft)] last:border-0">
                <td className={`${td} whitespace-nowrap`}>{formatDateTimeAr(p.created_at)}</td><td className={td}>{providerLabel(p.provider)}</td><td className={td}>{p.plans?.name ?? '—'}</td>
                <td className={`${td} whitespace-nowrap`}>{formatArs(p.amount)}</td><td className={td}><CategoryBadge p={p} /></td>
                <td className={`${td} whitespace-nowrap`}>{p.applied_at ? formatDateAr(p.applied_at) : '—'}</td><td className={`${td} whitespace-nowrap`}>{p.covered_until ? `hasta ${formatDateAr(p.covered_until)}` : '—'}</td>
                <td className={td}><a className="text-[var(--oc-brand)] hover:underline" href={`/admin/facturacion/pagos/${p.id}`}>Detalle</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-xs text-[var(--oc-muted)]">Página {page} de {pages}</span>
        <div className="flex gap-2">
          {page > 1 ? <a className={btnGhost} href={`?pagina=${page - 1}`}>Anterior</a> : null}
          {page < pages ? <a className={btnGhost} href={`?pagina=${page + 1}`}>Siguiente</a> : null}
        </div>
      </div>
    </div>
  )
}

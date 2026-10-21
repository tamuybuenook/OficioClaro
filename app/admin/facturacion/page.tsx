import { requireAdmin } from '@/lib/auth/require-admin'
import { parseBillingFilters, filtersToQuery, type SearchParams } from '@/lib/admin/billing/filters'
import { CATEGORIES, CATEGORY_LABEL, type Category, type ProviderSummary } from '@/lib/admin/billing/classify'
import { fetchAlerts, fetchEventsPage, fetchPaymentsPage, fetchPaymentsSummary, fetchSubscriptionsSummary } from '@/lib/admin/billing/queries'
import { formatArs, formatDateAr, formatDateTimeAr } from '@/lib/admin/billing/format'
import { Badge } from '@/components/ui/badge'
import { periodAdjective } from '@/lib/plan-period'
import { CategoryBadge, Crumbs, EmptyRow, Mono, OutcomeBadge, Pagination, Stat, btnCls, btnGhost, card, incidentLabel, inputCls, providerLabel, td, th } from '@/components/admin/billing/ui'

export const dynamic = 'force-dynamic'

const PERIODS: [string, string][] = [['mes', 'Mes actual'], ['mes_anterior', 'Mes anterior'], ['30d', 'Últimos 30 días'], ['anio', 'Año en curso'], ['todo', 'Todo el historial'], ['custom', 'Personalizado']]

export default async function FacturacionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { supabase } = await requireAdmin()
  const f = parseBillingFilters(await searchParams)

  // Cada bloque se carga acotado (paginado o agregado en trozos): nunca se trae todo el historial de una vez.
  const [paySum, subSum, alerts, list, events] = await Promise.all([
    fetchPaymentsSummary(supabase, f),
    fetchSubscriptionsSummary(supabase),
    fetchAlerts(supabase),
    f.vista === 'pagos' ? fetchPaymentsPage(supabase, f) : Promise.resolve(null),
    f.vista === 'eventos' ? fetchEventsPage(supabase, f) : Promise.resolve(null),
  ])
  const t = paySum.summary.total
  const mp = paySum.summary.byProvider.mercadopago
  const tr = paySum.summary.byProvider.transfer
  const periodLabel = f.from || f.to ? `${f.from ? formatDateAr(f.from) : 'inicio'} al ${f.to ? formatDateAr(f.to) : 'hoy'}` : 'todo el historial'
  const attention = alerts.held + alerts.refundPending + alerts.unapplied + alerts.cancelling.length + alerts.uncertainIntents + alerts.staleMpPending

  return (
    <div>
      <Crumbs items={[{ href: '/admin', label: 'Admin' }, { label: 'Facturación' }]} />
      <h1 className="mt-1 text-2xl font-bold">Facturación y pagos</h1>
      <p className="mt-1 text-xs text-[var(--oc-muted)]">
        Vista de lectura, calculada desde los estados reales de la base. El período filtra por fecha de creación del pago (hora argentina). Los importes cobrados no incluyen intentos, pendientes, rechazados, retenidos ni reembolsos.
      </p>

      {/* ---- Filtros ---- */}
      <form method="get" className={`${card} mt-5 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6`}>
        {f.vista !== 'pagos' && <input type="hidden" name="vista" value={f.vista} />}
        <label className="text-xs text-[var(--oc-muted)] lg:col-span-2">Buscar (usuario, id interno, id de Mercado Pago, referencia, AAAA-MM)
          <input name="q" defaultValue={f.q} maxLength={60} placeholder="Ej: Pérez · 1234567890 · 2026-10" className={`${inputCls} mt-1`} />
        </label>
        <label className="text-xs text-[var(--oc-muted)]">Estado
          <select name="estado" defaultValue={f.status ?? ''} className={`${inputCls} mt-1`}>
            <option value="">Todos</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--oc-muted)]">Proveedor
          <select name="proveedor" defaultValue={f.provider ?? ''} className={`${inputCls} mt-1`}>
            <option value="">Todos</option><option value="mercadopago">Mercado Pago</option><option value="transfer">Transferencia</option>
          </select>
        </label>
        <label className="text-xs text-[var(--oc-muted)]">Período
          <select name="periodo" defaultValue={f.qKind === 'period' ? 'custom' : f.preset} className={`${inputCls} mt-1`}>
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className={btnCls}>Aplicar</button>
          <a href="/admin/facturacion" className={btnGhost}>Limpiar</a>
        </div>
        <label className="text-xs text-[var(--oc-muted)] sm:col-span-1">Desde (con «Personalizado»)
          <input type="date" name="desde" defaultValue={f.preset === 'custom' ? f.from ?? '' : ''} className={`${inputCls} mt-1`} />
        </label>
        <label className="text-xs text-[var(--oc-muted)] sm:col-span-1">Hasta
          <input type="date" name="hasta" defaultValue={f.preset === 'custom' ? f.to ?? '' : ''} className={`${inputCls} mt-1`} />
        </label>
      </form>

      {/* ---- Resumen ---- */}
      <h2 className="mt-8 text-lg font-bold">Resumen · {periodLabel}</h2>
      {paySum.truncated && <p className="mt-2 rounded-xl bg-[var(--oc-warning-bg)] p-3 text-xs text-[var(--oc-warning-text)]">El período tiene más de 20.000 pagos: los totales son parciales. Acotá el rango de fechas.</p>}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total cobrado" value={formatArs(t.cobrado.amount)} sub={`${t.cobrado.count} pago(s) aprobado(s)`} />
        <Stat label="Pendientes" value={t.pendiente.count} sub={`${formatArs(t.pendiente.amount)} · ${t.unpaid_intents} intento(s) sin pago`} />
        <Stat label="Rechazados" value={t.rechazado.count} sub={formatArs(t.rechazado.amount)} />
        <Stat label="Reembolsados" value={t.reembolsado.count} sub={`${formatArs(t.reembolsado.amount)} (no se restan de lo cobrado)`} />
        <Stat label="Retenidos (revisión pendiente)" value={t.retenido.count} sub={formatArs(t.retenido.amount)} tone={t.retenido.count ? 'warn' : undefined} />
        <Stat label="Reembolso pendiente de devolver" value={t.reembolso_pendiente.count} sub={formatArs(t.reembolso_pendiente.amount)} tone={t.reembolso_pendiente.count ? 'warn' : undefined} />
        <Stat label="Aprobados sin aplicar" value={t.sin_aplicar.count} sub="No deberían existir: revisar" tone={t.sin_aplicar.count ? 'warn' : undefined} />
        <Stat label="Pagos en el período" value={paySum.summary.rows} />
      </div>

      <div className={`${card} mt-4 overflow-x-auto`}>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead><tr className="border-b border-[var(--oc-border-soft)]"><th className={th}>Proveedor</th><th className={th}>Cobrado</th><th className={th}>Aprobados</th><th className={th}>Pendientes</th><th className={th}>Rechazados</th><th className={th}>Reembolsados</th><th className={th}>Retenidos</th></tr></thead>
          <tbody>
            {([['Mercado Pago', mp], ['Transferencia', tr]] as [string, ProviderSummary][]).map(([name, s]) => (
              <tr key={name} className="border-b border-[var(--oc-border-soft)] last:border-0">
                <td className={`${td} font-semibold`}>{name}</td>
                <td className={td}>{formatArs(s.cobrado.amount)}</td><td className={td}>{s.cobrado.count}</td><td className={td}>{s.pendiente.count}</td>
                <td className={td}>{s.rechazado.count}</td><td className={td}>{s.reembolsado.count}</td><td className={td}>{s.retenido.count + s.reembolso_pendiente.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-lg font-bold">Suscripciones (hoy)</h2>
      <p className="mt-1 text-xs text-[var(--oc-muted)]">Una por usuario (la más reciente), con la regla de acceso vigente.{subSum.truncated && ' Conteo parcial: más de 20.000 filas.'}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Activas" value={subSum.summary.active} sub={`${subSum.summary.trial} en prueba`} />
        <Stat label="Con renovación automática" value={subSum.summary.auto_renew} sub="Autorización vigente en MP" />
        <Stat label="Vencidas" value={subSum.summary.expired} sub={`${subSum.summary.suspended} suspendida(s)`} />
        <Stat label="Cobro fallido / sin renovar" value={`${subSum.summary.past_due} / ${subSum.summary.cancelled_with_access}`} sub="Siguen con acceso hasta el vencimiento" />
      </div>

      {/* ---- Alertas ---- */}
      <h2 className="mt-8 text-lg font-bold">Alertas {attention > 0 && <Badge tone="warning">{attention} para revisar</Badge>}</h2>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className={`${card} p-4`}>
          <p className="text-sm font-semibold">Pagos y conciliación</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <AlertLine n={alerts.held} label="Cobros retenidos a la espera de revisión" href={`/admin/facturacion?estado=retenido&periodo=todo`} />
            <AlertLine n={alerts.refundPending} label="Reembolsos pendientes de devolver" href={`/admin/facturacion?estado=reembolso_pendiente&periodo=todo`} />
            <AlertLine n={alerts.unapplied} label="Pagos de MP aprobados sin aplicar" href={`/admin/facturacion?estado=sin_aplicar&periodo=todo`} />
            <AlertLine n={alerts.uncertainIntents} label="Intentos con resultado incierto al crearse en MP" />
            <AlertLine n={alerts.staleMpPending} label="Pagos pendientes en MP hace más de 48 h" href={`/admin/facturacion?estado=pendiente&proveedor=mercadopago&periodo=todo`} />
            <AlertLine n={alerts.webhookProblems7d} label="Notificaciones con error o rechazadas (7 días)" href="/admin/facturacion?vista=eventos&resultado=error" />
            <AlertLine n={alerts.incidents30d} label="Incidencias registradas (30 días)" />
          </ul>
        </div>
        <div className={`${card} p-4`}>
          <p className="text-sm font-semibold">Autorizaciones que quedaron en «cancelándose» <span className="font-normal text-[var(--oc-muted)]">({alerts.cancelling.length})</span></p>
          {alerts.cancelling.length === 0 ? <p className="mt-3 text-sm text-[var(--oc-muted)]">Ninguna.</p> : (
            <ul className="mt-3 flex flex-col gap-3 text-sm">
              {alerts.cancelling.map((c) => (
                <li key={c.id} className="rounded-xl bg-[var(--oc-surface-muted)] p-3">
                  <p className="font-semibold">{c.user_id ? <a className="hover:underline" href={`/admin/facturacion/clientes/${c.user_id}`}>{c.full_name ?? 'Usuario'}</a> : 'Usuario'} · {c.cancel_attempts} intento(s)</p>
                  <p className="text-xs text-[var(--oc-muted)]">MP: <Mono>{c.preapproval_id ?? '—'}</Mono> · desde {formatDateTimeAr(c.updated_at)}</p>
                  {c.last_error && <p className="mt-1 text-xs text-[var(--oc-warning-text)]">{c.last_error}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-[var(--oc-muted)]">Se reintentan solas con la conciliación periódica (si está activa) o en la siguiente acción del usuario o del webhook.</p>
        </div>
        <div className={`${card} p-4 lg:col-span-2`}>
          <p className="text-sm font-semibold">Últimas incidencias</p>
          {alerts.recentIncidents.length === 0 ? <p className="mt-3 text-sm text-[var(--oc-muted)]">Sin incidencias registradas.</p> : (
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {alerts.recentIncidents.map((i) => (
                <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--oc-border-soft)] pb-2 last:border-0">
                  <span className="font-medium">{incidentLabel(i.action)}</span>
                  <span className="text-xs text-[var(--oc-muted)]">{formatDateTimeAr(i.created_at)} · <Mono>{i.entity}{i.entity_id ? ` ${i.entity_id.slice(0, 8)}…` : ''}</Mono></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---- Pestañas ---- */}
      <div className="mt-8 flex gap-2 border-b border-[var(--oc-border)]">
        <Tab href={`/admin/facturacion${filtersToQuery({ ...f, vista: 'pagos' })}`} active={f.vista === 'pagos'}>Pagos</Tab>
        <Tab href={`/admin/facturacion${filtersToQuery({ ...f, vista: 'eventos' })}`} active={f.vista === 'eventos'}>Eventos de Mercado Pago</Tab>
      </div>

      {list && (
        <>
          <div className={`${card} mt-4 overflow-x-auto`}>
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead><tr className="border-b border-[var(--oc-border-soft)]">
                <th className={th}>Fecha</th><th className={th}>Usuario</th><th className={th}>Medio</th><th className={th}>Plan</th><th className={th}>Importe</th><th className={th}>Estado</th>
                <th className={th}>Identificadores</th><th className={th}>Aplicado</th><th className={th}>Período cubierto</th><th className={th}></th>
              </tr></thead>
              <tbody>
                {list.rows.length === 0 && <EmptyRow cols={10}>No hay pagos con esos filtros.</EmptyRow>}
                {list.rows.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--oc-border-soft)] last:border-0">
                    <td className={`${td} whitespace-nowrap`}>{formatDateTimeAr(p.created_at)}</td>
                    <td className={td}>{p.subscriptions?.user_id ? <a className="font-semibold hover:underline" href={`/admin/facturacion/clientes/${p.subscriptions.user_id}`}>{p.subscriptions.profiles?.full_name ?? 'Sin nombre'}</a> : '—'}</td>
                    <td className={td}>{providerLabel(p.provider)}{p.mp_status && <p className="text-xs text-[var(--oc-muted)]">{p.mp_status}</p>}</td>
                    <td className={td}>{p.plans?.name ?? '—'}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatArs(p.amount)}</td>
                    <td className={td}><CategoryBadge p={p} /></td>
                    <td className={td}><p className="text-[11px] text-[var(--oc-muted)]">Interno</p><Mono>{p.id.slice(0, 8)}…</Mono><p className="mt-1 text-[11px] text-[var(--oc-muted)]">Mercado Pago</p><Mono>{p.external_id ?? '—'}</Mono></td>
                    <td className={`${td} whitespace-nowrap`}>{p.applied_at ? formatDateAr(p.applied_at) : '—'}</td>
                    <td className={`${td} whitespace-nowrap`}>{p.covered_until ? `hasta ${formatDateAr(p.covered_until)}` : '—'}{p.covered_until && p.plans && <p className="text-xs text-[var(--oc-muted)] capitalize">{periodAdjective(p.plans.billing_period)}</p>}</td>
                    <td className={td}><a href={`/admin/facturacion/pagos/${p.id}`} className="text-[var(--oc-brand)] hover:underline">Detalle</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={f.page} total={list.total} base="/admin/facturacion" f={f} />
        </>
      )}

      {events && (
        <>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {[['', 'Todos'], ['processed', 'Procesados'], ['duplicate', 'Duplicados'], ['ignored', 'Ignorados'], ['rejected', 'Rechazados'], ['error', 'Error']].map(([v, l]) => (
              <a key={v} href={`/admin/facturacion${filtersToQuery({ ...f, outcome: v || null, page: 1 })}`} className={`rounded-full border px-3 py-1 ${((f.outcome ?? '') === v) ? 'border-[var(--oc-brand)] bg-[var(--oc-brand-soft)] text-[var(--oc-brand)]' : 'border-[var(--oc-border)] text-[var(--oc-ink)]'}`}>{l}</a>
            ))}
          </div>
          <div className={`${card} mt-3 overflow-x-auto`}>
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead><tr className="border-b border-[var(--oc-border-soft)]"><th className={th}>Recibido</th><th className={th}>Tipo</th><th className={th}>Identificador</th><th className={th}>Resultado</th><th className={th}>Motivo / detalle</th><th className={th}>Procesado</th></tr></thead>
              <tbody>
                {events.rows.length === 0 && <EmptyRow cols={6}>Sin eventos registrados.</EmptyRow>}
                {events.rows.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--oc-border-soft)] last:border-0">
                    <td className={`${td} whitespace-nowrap`}>{formatDateTimeAr(e.received_at)}</td>
                    <td className={td}>{e.topic ?? '—'}</td>
                    <td className={td}>{e.payment_id ? <a className="hover:underline" href={`/admin/facturacion/pagos/${e.payment_id}`}><Mono>{e.data_id}</Mono></a> : <Mono>{e.data_id ?? '—'}</Mono>}</td>
                    <td className={td}><OutcomeBadge outcome={e.outcome} /></td>
                    <td className={`${td} max-w-[360px] break-words text-xs`}>{e.detail ?? '—'}</td>
                    <td className={`${td} whitespace-nowrap`}>{e.processed_at ? formatDateTimeAr(e.processed_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={f.page} total={events.total} base="/admin/facturacion" f={f} />
        </>
      )}
    </div>
  )
}

function AlertLine({ n, label, href }: { n: number; label: string; href?: string }) {
  const body = <><span className={`inline-flex min-w-8 justify-center rounded-full px-2 py-0.5 text-xs font-bold ${n ? 'bg-[var(--oc-warning-bg)] text-[var(--oc-warning-text)]' : 'bg-[var(--oc-neutral-bg)] text-[var(--oc-neutral-text)]'}`}>{n}</span><span>{label}</span></>
  return <li>{href && n > 0 ? <a href={href} className="flex items-center gap-3 hover:underline">{body}</a> : <span className="flex items-center gap-3">{body}</span>}</li>
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <a href={href} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${active ? 'border-[var(--oc-brand)] text-[var(--oc-brand)]' : 'border-transparent text-[var(--oc-muted)] hover:text-[var(--oc-ink)]'}`}>{children}</a>
}

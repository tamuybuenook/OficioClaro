import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/require-admin'
import { fetchPaymentDetail } from '@/lib/admin/billing/queries'
import { fetchUserEmail } from '@/lib/admin/billing/user-email'
import { CATEGORY_LABEL, classifyPayment } from '@/lib/admin/billing/classify'
import { formatArs, formatDateAr, formatDateTimeAr } from '@/lib/admin/billing/format'
import { CategoryBadge, Crumbs, KeyValue, Mono, OutcomeBadge, card, incidentLabel, providerLabel } from '@/components/admin/billing/ui'
import { periodAdjective } from '@/lib/plan-period'

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ACTION_LABEL: Record<string, string> = {
  mp_approved: 'Pago aprobado y aplicado a la suscripción', reconcile: 'Transferencia conciliada por un administrador',
  held_payment_apply: 'Cobro retenido: aplicado por un administrador', held_payment_refund: 'Cobro retenido: marcado para reembolso',
  mp_incident_payment_held: 'Cobro retenido por el estado de la suscripción',
}

export default async function PagoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdmin()
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()
  const d = await fetchPaymentDetail(supabase, id)
  if (!d) notFound()
  const p = d.payment
  const sub = p.subscriptions
  const userId: string | null = sub?.user_id ?? null
  const email = userId ? await fetchUserEmail(userId) : null
  const category = classifyPayment(p)
  const coveredUntil = d.logs.map((l) => l.new_value?.end_date).find((x) => typeof x === 'string') as string | undefined
  const billable = category === 'cobrado'

  return (
    <div className="max-w-5xl">
      <Crumbs items={[{ href: '/admin', label: 'Admin' }, { href: '/admin/facturacion', label: 'Facturación' }, { label: 'Pago' }]} />
      <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold">Pago de {formatArs(p.amount)} <CategoryBadge p={p} /></h1>
      <p className="mt-1 text-xs text-[var(--oc-muted)]">Vista de lectura. Para cambiar el estado de un pago se usan las operaciones validadas del servidor, no esta pantalla.</p>

      <div className={`${card} mt-5 p-5`}>
        <h2 className="mb-4 font-bold">Pago</h2>
        <KeyValue rows={[
          ['Identificador interno', <Mono key="i">{p.id}</Mono>],
          ['Identificador de Mercado Pago', <Mono key="e">{p.external_id ?? '—'}</Mono>],
          ['Medio', providerLabel(p.provider)],
          ['Estado', CATEGORY_LABEL[category]],
          ['Estado informado por MP', p.mp_status ? `${p.mp_status}${p.mp_status_detail ? ` · ${p.mp_status_detail}` : ''}` : '—'],
          ['Importe', formatArs(p.amount)],
          ['Plan', p.plans ? `${p.plans.name} (${periodAdjective(p.plans.billing_period)})` : '—'],
          ['Creado', formatDateTimeAr(p.created_at)],
          ['Última actualización', formatDateTimeAr(p.updated_at)],
          ['Aplicado a la suscripción', p.applied_at ? formatDateTimeAr(p.applied_at) : 'No aplicado'],
          ['Período cubierto', coveredUntil ? `hasta ${formatDateAr(coveredUntil)}` : '—'],
          ['Referencia informada', p.reference ?? '—'],
          ['Motivo de retención', p.review_reason === 'subscription_suspended' ? 'Suscripción suspendida' : p.review_reason === 'subscription_cancelled' ? 'Suscripción cancelada' : '—'],
          ['Resolución de la revisión', p.review_resolution ? ({ applied: 'Aplicado', refund_pending: 'Reembolso pendiente', refunded: 'Reembolsado' } as Record<string, string>)[p.review_resolution] ?? p.review_resolution : p.review_reason ? 'Pendiente de revisión' : '—'],
          ['Revisado', p.reviewed_at ? formatDateTimeAr(p.reviewed_at) : '—'],
        ]} />
        {p.proof_url && <p className="mt-4 text-sm">Comprobante informado: <a className="text-[var(--oc-brand)] hover:underline" href={p.proof_url} target="_blank" rel="noopener noreferrer">abrir</a></p>}
      </div>

      <div className={`${card} mt-4 p-5`}>
        <h2 className="mb-4 font-bold">Cliente y suscripción</h2>
        <KeyValue rows={[
          ['Usuario', userId ? <a key="u" className="text-[var(--oc-brand)] hover:underline" href={`/admin/facturacion/clientes/${userId}`}>{sub?.profiles?.full_name ?? 'Sin nombre'} · ver cliente</a> : '—'],
          ['Email', email ?? 'No disponible'],
          ['Teléfono', sub?.profiles?.phone ?? '—'],
          ['Estado de la suscripción', sub?.status ?? '—'],
          ['Vigencia', sub ? `${formatDateAr(sub.start_date)} → ${formatDateAr(sub.end_date)}` : '—'],
          ['Autorización recurrente', sub?.mp_status ?? 'Sin autorización'],
        ]} />
      </div>

      {/* Preparación para una futura factura. No se emite nada acá. */}
      <div className={`${card} mt-4 p-5`}>
        <h2 className="font-bold">Datos para un futuro comprobante fiscal</h2>
        <p className="mt-1 rounded-xl bg-[var(--oc-warning-bg)] p-3 text-xs text-[var(--oc-warning-text)]">
          No hay ninguna factura emitida ni vinculada a este pago. Mercado Pago registra el cobro pero no emite comprobantes de ARCA; la emisión se hará desde NexoFactory en una etapa posterior.
        </p>
        <div className="mt-4">
          <KeyValue rows={[
            ['Pago facturable', billable ? 'Sí: cobro confirmado' : `No por ahora: estado «${CATEGORY_LABEL[category]}»`],
            ['Concepto', p.plans ? `Suscripción OficioClaro — plan ${p.plans.name} (${periodAdjective(p.plans.billing_period)})${coveredUntil ? `, hasta ${formatDateAr(coveredUntil)}` : ''}` : 'Suscripción OficioClaro'],
            ['Importe cobrado (ARS)', formatArs(p.amount)],
            ['Fecha de cobro', formatDateTimeAr(p.applied_at ?? p.created_at)],
            ['Medio y referencia', `${providerLabel(p.provider)}${p.external_id ? ` · ${p.external_id}` : p.reference ? ` · ${p.reference}` : ''}`],
            ['Receptor (nombre)', sub?.profiles?.full_name ?? 'No registrado'],
            ['Receptor (email)', email ?? 'No disponible'],
            ['CUIT / DNI del receptor', 'No registrado en OficioClaro'],
            ['Condición frente al IVA', 'No registrada en OficioClaro'],
            ['Comprobante vinculado', 'Ninguno'],
          ]} />
        </div>
        <p className="mt-3 text-xs text-[var(--oc-muted)]">Para vincular comprobantes de forma segura hace falta una migración incremental (propuesta en docs/PROPUESTA_FACTURACION_FISCAL.md, sin aplicar).</p>
      </div>

      <div className={`${card} mt-4 p-5`}>
        <h2 className="mb-3 font-bold">Historial del pago</h2>
        {d.logs.length === 0 && d.reconciliations.length === 0 ? <p className="text-sm text-[var(--oc-muted)]">Sin movimientos registrados.</p> : (
          <ul className="flex flex-col gap-3 text-sm">
            {d.logs.map((l: any) => (
              <li key={l.id} className="border-b border-[var(--oc-border-soft)] pb-3 last:border-0">
                <p className="font-medium">{ACTION_LABEL[l.action] ?? incidentLabel(l.action)}</p>
                <p className="text-xs text-[var(--oc-muted)]">{formatDateTimeAr(l.created_at)}{l.actor_id ? ' · administrador' : ' · sistema'}{l.new_value?.end_date ? ` · vencimiento ${formatDateAr(l.new_value.end_date)}` : ''}{l.new_value?.notes ? ` · ${l.new_value.notes}` : ''}</p>
              </li>
            ))}
            {d.reconciliations.map((r: any) => (
              <li key={r.id} className="border-b border-[var(--oc-border-soft)] pb-3 last:border-0">
                <p className="font-medium">Conciliación bancaria: {r.status === 'reconciled' ? 'aprobada' : 'rechazada'}</p>
                <p className="text-xs text-[var(--oc-muted)]">{formatDateTimeAr(r.created_at)}{r.notes ? ` · ${r.notes}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.external_id && (
        <div className={`${card} mt-4 overflow-x-auto p-5`}>
          <h2 className="mb-3 font-bold">Notificaciones de Mercado Pago de este pago</h2>
          {d.events.length === 0 ? <p className="text-sm text-[var(--oc-muted)]">No hay notificaciones registradas con ese identificador.</p> : (
            <ul className="flex flex-col gap-3 text-sm">
              {d.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--oc-border-soft)] pb-3 last:border-0">
                  <OutcomeBadge outcome={e.outcome} /><span className="text-xs text-[var(--oc-muted)]">{formatDateTimeAr(e.received_at)} · {e.topic}</span>
                  {e.detail && <span className="text-xs">{e.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

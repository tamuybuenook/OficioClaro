'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { startMpCheckout, cancelMpRenewal, syncMyPayments } from '@/lib/actions/mercadopago'
import { money } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { periodUnit, type PlanPeriod } from '@/lib/plan-period'

export type SubscriptionInfo = {
  id: string; planName: string; status: string; endDate: string | null
  state: 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'suspended' | 'none'
  planId: string; autoRenew: boolean; autoRenewPending: boolean
} | null

export type BillingInfo = {
  mpAvailable: boolean
  plans: { id: string; name: string; price: number; billingPeriod: PlanPeriod; maxTrades: number | null }[]
  payments: { id: string; createdAt: string; amount: number; status: string; provider: string; planName: string | null }[]
  mpReturn: 'ok' | 'pending' | 'error' | null
}

const STATE_LABEL: Record<string, { text: string; tone: 'success' | 'warning' | 'neutral' | 'blue' }> = {
  trial: { text: 'Prueba gratuita', tone: 'blue' },
  active: { text: 'Activa', tone: 'success' },
  past_due: { text: 'Pago pendiente', tone: 'warning' },
  cancelled: { text: 'Sin renovación', tone: 'neutral' },
  expired: { text: 'Vencida', tone: 'warning' },
  suspended: { text: 'Suspendida', tone: 'warning' },
  none: { text: 'Sin plan', tone: 'neutral' },
}
const PAY_LABEL: Record<string, { text: string; tone: 'success' | 'warning' | 'neutral' }> = {
  reconciled: { text: 'Aprobado', tone: 'success' },
  pending: { text: 'Pendiente', tone: 'warning' },
  rejected: { text: 'Rechazado', tone: 'neutral' },
  refunded: { text: 'Reembolsado', tone: 'neutral' },
}
const fmtDate = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-AR') : '—')
const limitText = (n: number | null) => (n === null ? 'Todos los oficios' : n === 1 ? '1 oficio' : `${n} oficios`)
const input = 'rounded-xl border border-[var(--oc-border)] bg-transparent px-3 py-3 text-sm text-[var(--oc-ink)] outline-none'
const card = 'mt-4 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5'

export function SubscriptionView({ subscription, billing, onReportPayment, reportPending }: {
  subscription: SubscriptionInfo; billing: BillingInfo
  onReportPayment: (formData: FormData) => void; reportPending: boolean
}) {
  const router = useRouter()
  const [planId, setPlanId] = useState(subscription?.planId ?? billing.plans[0]?.id ?? '')
  const [mode, setMode] = useState<'one_time' | 'recurring'>('one_time')
  const [error, setError] = useState<string | null>(null)
  const [payerEmail, setPayerEmail] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(billing.mpReturn === 'ok' || billing.mpReturn === 'pending')
  const [confirmed, setConfirmed] = useState(false)
  const startEnd = useRef(subscription?.endDate ?? null)

  // Al volver de Mercado Pago NO se activa nada por la URL: se consulta el estado real (lo confirma el webhook).
  useEffect(() => {
    if (!confirming) return
    let tries = 0
    const t = setInterval(() => {
      tries += 1
      // Consulta a Mercado Pago el estado real (cubre webhooks demorados) y recarga los datos.
      syncMyPayments().finally(() => router.refresh())
      if (tries >= 12) { clearInterval(t); setConfirming(false) }
    }, 5000)
    return () => clearInterval(t)
  }, [confirming, router])
  useEffect(() => {
    if (confirming && subscription && subscription.endDate !== startEnd.current && subscription.state === 'active') {
      setConfirming(false); setConfirmed(true)
    }
  }, [confirming, subscription])

  const state = STATE_LABEL[subscription?.state ?? 'none']
  const plan = billing.plans.find((p) => p.id === planId)
  const busy = pending
  const hasPendingMp = billing.payments.some((p) => p.provider === 'mercadopago' && p.status === 'pending')

  function pay() {
    setError(null)
    startTransition(async () => {
      const res = await startMpCheckout(planId, mode, mode === 'recurring' ? payerEmail.trim() : undefined)
      if (res.error || !res.url) { setError(res.error ?? 'No se pudo iniciar el pago.'); return }
      window.location.href = res.url
    })
  }
  function verify() {
    setError(null); setNotice(null)
    startTransition(async () => {
      const res = await syncMyPayments()
      if (res.error) { setError(res.error); return }
      setNotice(res.processed ? 'Encontramos novedades de tu pago.' : 'Todavía no hay novedades en Mercado Pago. Si ya pagaste, puede demorar unos minutos.')
      router.refresh()
    })
  }
  function cancelRenewal() {
    setError(null)
    startTransition(async () => {
      const res = await cancelMpRenewal()
      if (res.error) setError(res.error); else router.refresh()
    })
  }

  return (
    <div className="mx-auto max-w-[760px] p-5 pb-28 md:p-8">
      <p className="text-sm text-[var(--oc-muted)]">Cuenta</p>
      <h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Mi suscripción</h1>

      {billing.mpReturn === 'error' && !confirmed && <p role="alert" className="mt-4 rounded-xl bg-[var(--oc-warning-bg)] p-3 text-sm text-[var(--oc-warning-text)]">El pago no se completó. No se te cobró nada; podés intentarlo de nuevo.</p>}
      {confirming && <p role="status" className="mt-4 rounded-xl bg-[var(--oc-blue-bg)] p-3 text-sm text-[var(--oc-blue-text)]">Estamos confirmando tu pago con Mercado Pago. Puede demorar unos minutos; no hace falta que hagas nada.</p>}
      {!confirming && billing.mpReturn && billing.mpReturn !== 'error' && !confirmed && <p role="status" className="mt-4 rounded-xl bg-[var(--oc-neutral-bg)] p-3 text-sm text-[var(--oc-neutral-text)]">Todavía no recibimos la confirmación del pago. Apenas Mercado Pago la envíe, tu plan se actualiza solo.</p>}
      {confirmed && <p role="status" className="mt-4 rounded-xl bg-[var(--oc-success-bg)] p-3 text-sm text-[var(--oc-success-text)]">¡Pago confirmado! Tu plan está activo.</p>}

      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[var(--oc-muted)]">Estado de cuenta</p>
            <p className="mt-1 text-lg font-bold text-[var(--oc-ink)]">{subscription?.planName ?? 'Sin plan'}</p>
            <div className="mt-2 flex flex-wrap gap-2"><Badge tone={state.tone}>{state.text}</Badge>{subscription?.autoRenew && <Badge tone="success">Renovación automática</Badge>}{subscription?.autoRenewPending && <Badge tone="warning">Autorización pendiente</Badge>}</div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs text-[var(--oc-muted)]">{subscription?.state === 'expired' ? 'Venció el' : 'Acceso hasta'}</p>
            <p className="mt-1 font-bold text-[var(--oc-ink)]">{fmtDate(subscription?.endDate ?? null)}</p>
          </div>
        </div>
        {subscription?.state === 'past_due' && <p className="mt-4 text-sm text-[var(--oc-warning-text)]">No pudimos cobrar tu última renovación. Mantenés el acceso hasta la fecha indicada; actualizá tu medio de pago en Mercado Pago o pagá manualmente.</p>}
        {subscription?.state === 'expired' && <p className="mt-4 text-sm text-[var(--oc-warning-text)]">Tu acceso venció. Tus datos, clientes y agenda se conservan; elegí un plan para volver a usar tus oficios.</p>}
        {subscription?.state === 'suspended' && <p className="mt-4 text-sm text-[var(--oc-warning-text)]">Tu cuenta está suspendida. Escribinos para resolverlo.</p>}
        {subscription?.autoRenew && <button type="button" onClick={cancelRenewal} disabled={busy} className="mt-4 text-sm font-bold text-[var(--oc-coral)] underline disabled:opacity-60">Cancelar renovación automática</button>}
      </section>

      {billing.mpAvailable && subscription?.state !== 'suspended' && (
        <section className={card} aria-labelledby="pay-title">
          <h2 id="pay-title" className="font-bold text-[var(--oc-ink)]">Pagar con Mercado Pago</h2>
          <fieldset className="mt-3 grid gap-2">
            <legend className="sr-only">Plan</legend>
            {billing.plans.map((p) => (
              <label key={p.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 text-sm ${planId === p.id ? 'border-[var(--oc-brand)] bg-[var(--oc-surface-soft)]' : 'border-[var(--oc-border)]'}`}>
                <span className="flex items-center gap-3"><input type="radio" name="plan" checked={planId === p.id} onChange={() => setPlanId(p.id)} /><span><span className="block font-bold text-[var(--oc-ink)]">{p.name}</span><span className="text-xs text-[var(--oc-muted)]">{limitText(p.maxTrades)}</span></span></span>
                <span className="font-bold text-[var(--oc-ink)]">{money(p.price)}<span className="text-xs font-normal text-[var(--oc-muted)]"> / {periodUnit(p.billingPeriod)}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setMode('one_time')} aria-pressed={mode === 'one_time'} className={`rounded-xl border p-3 text-left text-sm ${mode === 'one_time' ? 'border-[var(--oc-brand)] bg-[var(--oc-surface-soft)]' : 'border-[var(--oc-border)]'}`}><span className="block font-bold text-[var(--oc-ink)]">Pagar este período</span><span className="text-xs text-[var(--oc-muted)]">Un solo pago. Renovás vos cuando quieras.</span></button>
            <button type="button" onClick={() => setMode('recurring')} aria-pressed={mode === 'recurring'} className={`rounded-xl border p-3 text-left text-sm ${mode === 'recurring' ? 'border-[var(--oc-brand)] bg-[var(--oc-surface-soft)]' : 'border-[var(--oc-border)]'}`}><span className="block font-bold text-[var(--oc-ink)]">Renovación automática</span><span className="text-xs text-[var(--oc-muted)]">Se cobra solo cada período. Cancelás cuando quieras.</span></button>
          </div>
          {mode === 'recurring' && (
            <label className="mt-3 block text-sm text-[var(--oc-ink)]">Email de tu cuenta de Mercado Pago
              <input type="email" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} placeholder="Vacío = el email de tu cuenta de OficioClaro" autoComplete="email" className={`${input} mt-1 w-full`} />
            </label>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-[var(--oc-coral)]">{error}</p>}
          <button type="button" onClick={pay} disabled={busy || !plan} className="mt-4 w-full rounded-xl bg-[var(--oc-brand)] px-4 py-3 text-sm font-bold text-white disabled:opacity-60 sm:w-auto">{busy ? 'Conectando con Mercado Pago…' : plan ? `Pagar ${money(plan.price)}` : 'Elegí un plan'}</button>
          <p className="mt-2 text-xs text-[var(--oc-muted)]">Pagás en el sitio de Mercado Pago. OficioClaro no guarda datos de tu tarjeta.</p>
          {hasPendingMp && <div className="mt-4 border-t border-[var(--oc-border-soft)] pt-4"><p className="text-sm text-[var(--oc-muted)]">Tenés un pago de Mercado Pago pendiente de confirmación.</p><button type="button" onClick={verify} disabled={busy} className="mt-2 rounded-xl border border-[var(--oc-border)] px-4 py-2 text-sm font-bold text-[var(--oc-ink)] disabled:opacity-60">{busy ? 'Verificando…' : 'Ya pagué, verificar'}</button>{notice && <p role="status" className="mt-2 text-xs text-[var(--oc-muted)]">{notice}</p>}</div>}
        </section>
      )}

      {billing.payments.length > 0 && (
        <section className={card}>
          <h2 className="font-bold text-[var(--oc-ink)]">Historial de pagos</h2>
          <ul className="mt-3 divide-y divide-[var(--oc-border-soft)]">
            {billing.payments.map((p) => {
              const l = PAY_LABEL[p.status] ?? PAY_LABEL.pending
              return <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span><span className="block text-[var(--oc-ink)]">{fmtDate(p.createdAt)} · {p.planName ?? 'Plan'}</span><span className="text-xs text-[var(--oc-muted)]">{p.provider === 'mercadopago' ? 'Mercado Pago' : 'Transferencia'}</span></span><span className="flex items-center gap-2"><span className="font-semibold text-[var(--oc-ink)]">{money(p.amount)}</span><Badge tone={l.tone}>{l.text}</Badge></span></li>
            })}
          </ul>
        </section>
      )}

      <details className={card}>
        <summary className="cursor-pointer font-bold text-[var(--oc-ink)]">Pagar por transferencia</summary>
        <form action={onReportPayment} className="mt-4">
          <p className="text-sm text-[var(--oc-muted)]">Cargá el monto transferido y la referencia para que Administración lo concilie.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input name="amount" type="number" required placeholder="Monto transferido" className={input} />
            <input name="reference" placeholder="Nº de operación" className={input} />
          </div>
          <button type="submit" disabled={reportPending || !subscription} className="mt-4 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">Informar pago</button>
          {!subscription && <p className="mt-2 text-xs text-[var(--oc-coral)]">Necesitás una suscripción antes de informar un pago.</p>}
        </form>
      </details>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { startMpCheckout, cancelMpRenewal, syncMyPayments } from '@/lib/actions/mercadopago'
import { money } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { periodUnit, type PlanPeriod } from '@/lib/plan-period'
import { daysText, paymentStatusInfo, providerLabel, stateInfo, type PaymentView } from '@/lib/account-summary'
import type { TransferInstructions } from '@/lib/transfer-instructions'
import { fmtDay } from '@/lib/subscription-notice'

export type SubscriptionInfo = {
  id: string; planName: string; status: string; endDate: string | null
  state: 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'suspended' | 'none'
  planId: string; autoRenew: boolean; autoRenewPending: boolean
} | null

export type BillingInfo = {
  mpAvailable: boolean
  plans: { id: string; name: string; price: number; billingPeriod: PlanPeriod; maxTrades: number | null }[]
  payments: PaymentView[]
  /** Datos para transferir a OficioClaro (variables de entorno del servidor). null = sin configurar. */
  transfer: TransferInstructions | null
  mpReturn: 'ok' | 'pending' | 'error' | null
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-AR') : '—')
const HISTORY_PAGE = 10
const limitText = (n: number | null) => (n === null ? 'Todos los oficios' : n === 1 ? '1 oficio' : `${n} oficios`)
const input = 'rounded-xl border border-[var(--oc-border)] bg-transparent px-3 py-3 text-sm text-[var(--oc-ink)] outline-none'
const card = 'mt-4 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5'

export type ReportResult = { error?: string; data?: unknown } | void

export function SubscriptionView({ subscription, billing, onReportPayment, reportPending, daysToEnd = null }: {
  subscription: SubscriptionInfo; billing: BillingInfo
  onReportPayment: (formData: FormData) => Promise<ReportResult> | ReportResult; reportPending: boolean
  /** Días hasta el vencimiento, calculados por el servidor con la fecha de Argentina. */
  daysToEnd?: number | null
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
  const [visible, setVisible] = useState(HISTORY_PAGE)

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

  const state = stateInfo(subscription?.state)
  const days = daysText(subscription?.state ?? 'none', daysToEnd)
  const pendingTransfers = billing.payments.filter((p) => p.provider === 'transfer' && p.status === 'pending')
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
            <div className="mt-2 flex flex-wrap gap-2"><Badge tone={state.tone}>{state.label}</Badge>{subscription?.autoRenew && <Badge tone="success">Renovación automática</Badge>}{subscription?.autoRenewPending && <Badge tone="warning">Autorización pendiente</Badge>}</div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs text-[var(--oc-muted)]">{subscription?.state === 'expired' ? 'Venció el' : subscription?.state === 'trial' ? 'Prueba hasta' : 'Acceso hasta'}</p>
            <p className="mt-1 font-bold text-[var(--oc-ink)]">{fmtDay(subscription?.endDate ?? null)}</p>
            {days && <p className="mt-0.5 text-xs font-semibold text-[var(--oc-muted)]" data-testid="days-left">{days}</p>}
          </div>
        </div>
        {subscription?.state === 'past_due' && <p className="mt-4 text-sm text-[var(--oc-warning-text)]">No pudimos cobrar tu última renovación. Mantenés el acceso hasta la fecha indicada; actualizá tu medio de pago en Mercado Pago o pagá manualmente.</p>}
        {subscription?.state === 'expired' && <p className="mt-4 text-sm text-[var(--oc-warning-text)]">Tu acceso venció. Tus datos, clientes y agenda se conservan; elegí un plan para volver a usar tus oficios.</p>}
        {subscription?.state === 'suspended' && <p className="mt-4 text-sm text-[var(--oc-warning-text)]">Tu cuenta está suspendida. Escribinos para resolverlo.</p>}
        {subscription?.autoRenew && <button type="button" onClick={cancelRenewal} disabled={busy} className="mt-4 text-sm font-bold text-[var(--oc-coral)] underline disabled:opacity-60">Cancelar renovación automática</button>}
      </section>

      {pendingTransfers.length > 0 && (
        <section className="mt-4 rounded-2xl bg-[var(--oc-blue-bg)] p-4 text-[var(--oc-blue-text)]" role="status" aria-label="Transferencia en revisión">
          <p className="font-bold">{pendingTransfers.length === 1 ? 'Tu transferencia está en revisión' : `Tenés ${pendingTransfers.length} transferencias en revisión`}</p>
          <p className="mt-1 text-sm">Administración está verificando que el dinero haya ingresado. No hace falta que hagas nada más: cuando se confirme, tu suscripción se actualiza sola.</p>
        </section>
      )}

      <TransferSection subscription={subscription} billing={billing} onReport={onReportPayment} reportPending={reportPending} defaultOpen={pendingTransfers.length === 0 && (subscription?.state === 'expired' || subscription?.state === 'past_due' || subscription?.state === 'trial' || !subscription)} />

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

      <PaymentHistory payments={billing.payments} visible={visible} onMore={() => setVisible((v) => v + HISTORY_PAGE)} />
    </div>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1800) } catch { /* sin permiso: el dato queda visible para copiarlo a mano */ }
  }
  return <button type="button" onClick={copy} aria-label={`Copiar ${label}`} className="min-h-11 shrink-0 rounded-lg border border-[var(--oc-border)] px-3 text-xs font-bold text-[var(--oc-brand)]">{done ? 'Copiado' : 'Copiar'}</button>
}

function TransferSection({ subscription, billing, onReport, reportPending, defaultOpen }: {
  subscription: SubscriptionInfo; billing: BillingInfo; onReport: (fd: FormData) => Promise<ReportResult> | ReportResult; reportPending: boolean; defaultOpen: boolean
}) {
  const router = useRouter()
  const t = billing.transfer
  const plan = billing.plans.find((p) => p.id === subscription?.planId)
  const [amount, setAmount] = useState(plan ? String(plan.price) : '')
  const [reference, setReference] = useState('')
  const [proof, setProof] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (sending.current || !subscription) return
    const n = Number(amount.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) { setFieldError('Ingresá el monto que transferiste (mayor que 0).'); return }
    setFieldError(null); setResult(null)
    sending.current = true; setBusy(true)
    try {
      const fd = new FormData()
      fd.set('amount', String(n)); fd.set('reference', reference.trim()); fd.set('proof_url', proof.trim())
      const res = await onReport(fd)
      if (res && typeof res === 'object' && 'error' in res && res.error) { setResult({ tone: 'error', text: res.error }); return }
      setResult({ tone: 'ok', text: 'Recibimos tu aviso. Administración va a verificar que el dinero haya ingresado y te actualiza la suscripción.' })
      setReference(''); setProof('')
      router.refresh()
    } catch {
      setResult({ tone: 'error', text: 'No pudimos enviar el aviso. Revisá tu conexión e intentá de nuevo.' })
    } finally { sending.current = false; setBusy(false) }
  }

  return (
    <details className={card} open={defaultOpen}>
      <summary className="min-h-11 cursor-pointer font-bold text-[var(--oc-ink)]">Pagar por transferencia</summary>
      <ol className="mt-3 grid gap-4 text-sm text-[var(--oc-ink)]">
        <li>
          <p className="font-semibold">1. Transferí a esta cuenta</p>
          {t && t.holder && t.holderCuit && t.cbu ? (
            <dl className="mt-2 grid gap-2 rounded-xl bg-[var(--oc-surface-soft)] p-3">
              {([['Banco', t.bank, false], ['Cuenta de', t.holder, false], ['CUIT/CUIL', t.holderCuit, false], ['CBU/CVU', t.cbu, true], ['Alias', t.alias, true]] as const).filter(([, v]) => v).map(([k, v, copy]) => (
                <div key={k} className="flex items-center justify-between gap-3"><div className="min-w-0"><dt className="text-xs text-[var(--oc-muted)]">{k}</dt><dd className="break-all font-bold">{v}</dd></div>{copy && <CopyButton value={v!} label={k} />}</div>
              ))}
              {t.note && <p className="text-xs text-[var(--oc-muted)]">{t.note}</p>}
            </dl>
          ) : (
            <p className="mt-2 rounded-xl bg-[var(--oc-warning-bg)] p-3 text-[var(--oc-warning-text)]">Los datos para transferir están incompletos o todavía no fueron cargados, así que no podemos mostrarte la cuenta. Escribinos y te los enviamos.</p>
          )}
          {plan && <p className="mt-2 text-xs text-[var(--oc-muted)]">Tu plan {plan.name}: {money(plan.price)} / {periodUnit(plan.billingPeriod)}.</p>}
        </li>
        <li>
          <p className="font-semibold">2. Avisanos cuando lo hagas</p>
          <form onSubmit={submit} className="mt-2" aria-busy={busy}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-semibold text-[var(--oc-muted)]">Monto transferido
                <input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!fieldError} className={`${input} text-base`} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-[var(--oc-muted)]">Nº de operación (opcional)
                <input name="reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className={`${input} text-base`} />
              </label>
            </div>
            <label className="mt-3 grid gap-1 text-xs font-semibold text-[var(--oc-muted)]">Enlace al comprobante (opcional)
              <input name="proof_url" type="url" inputMode="url" placeholder="https://…" value={proof} onChange={(e) => setProof(e.target.value)} maxLength={500} className={`${input} text-base`} />
            </label>
            {fieldError && <p role="alert" className="mt-2 text-sm font-semibold text-[var(--oc-coral)]">{fieldError}</p>}
            {result && <p role={result.tone === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold ${result.tone === 'error' ? 'bg-[var(--oc-danger-bg)] text-[var(--oc-coral)]' : 'bg-[var(--oc-success-bg)] text-[var(--oc-success-text)]'}`}>{result.text}</p>}
            <button type="submit" disabled={busy || reportPending || !subscription} className="mt-4 min-h-11 w-full rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60 sm:w-auto">{busy ? 'Enviando…' : 'Ya transferí: informar pago'}</button>
            {!subscription && <p className="mt-2 text-xs text-[var(--oc-coral)]">Necesitás una suscripción antes de informar un pago.</p>}
          </form>
        </li>
        <li><p className="font-semibold">3. Esperá la confirmación</p><p className="mt-1 text-[var(--oc-muted)]">Tu pago queda “En revisión” hasta que Administración confirme el ingreso. Nada se activa solo por avisar.</p></li>
      </ol>
    </details>
  )
}

function PaymentHistory({ payments, visible, onMore }: { payments: PaymentView[]; visible: number; onMore: () => void }) {
  return (
    <section className={card} aria-labelledby="hist-title">
      <h2 id="hist-title" className="font-bold text-[var(--oc-ink)]">Historial de pagos</h2>
      {payments.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--oc-muted)]">Todavía no hay pagos registrados. Cuando informes una transferencia o se acredite un pago, lo vas a ver acá.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-[var(--oc-border-soft)]">
            {payments.slice(0, visible).map((p) => {
              const l = paymentStatusInfo(p)
              return (
                <li key={p.id} className="py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--oc-ink)]">{money(p.amount)} · {providerLabel(p.provider)}</p>
                      <p className="text-xs text-[var(--oc-muted)]">{fmtDate(p.createdAt)}{p.planName ? ` · ${p.planName}` : ''}{p.reference ? ` · Ref. ${p.reference}` : ''}</p>
                    </div>
                    <Badge tone={l.tone}>{l.label}</Badge>
                  </div>
                  {l.hint && <p className="mt-1 text-xs text-[var(--oc-muted)]">{l.hint}</p>}
                  {p.proofUrl && <a href={p.proofUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block min-h-6 text-xs font-bold text-[var(--oc-brand)] underline">Ver comprobante que informaste</a>}
                </li>
              )
            })}
          </ul>
          {payments.length > visible && <button type="button" onClick={onMore} className="mt-2 min-h-11 text-sm font-bold text-[var(--oc-brand)] underline">Ver pagos anteriores</button>}
        </>
      )}
    </section>
  )
}

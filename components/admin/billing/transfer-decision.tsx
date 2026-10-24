'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reconcilePayment } from '@/lib/actions/payments'
import { MIN_REJECT_REASON } from '@/lib/payments-rules'
import { btnCls, btnGhost, card, inputCls } from '@/components/admin/billing/ui'

// Decisión del administrador sobre una transferencia PENDIENTE. Nada se aprueba sin confirmar que el dinero ingresó,
// y nada se rechaza sin motivo. La decisión real ocurre en el servidor (reconcile_transfer_payment): esta pantalla
// solo la solicita; si el pago ya fue resuelto por otra persona, la base lo rechaza y acá se muestra el motivo.

export type TransferFacts = {
  paymentId: string
  amountLabel: string
  reference: string | null
  proofUrl: string | null
  userLabel: string
  planLabel: string | null
  currentEndLabel: string | null
}

type Mode = 'idle' | 'approve' | 'reject'

export function TransferDecision({ facts }: { facts: TransferFacts }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [funds, setFunds] = useState(false)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ status: 'reconciled' | 'rejected'; endDate: string | null } | null>(null)
  const [pending, startTransition] = useTransition()
  const busy = useRef(false) // frena el doble clic antes de que React refleje `pending`

  const reasonOk = notes.trim().length >= MIN_REJECT_REASON
  const canSubmit = !pending && !done && (mode === 'approve' ? funds : mode === 'reject' ? reasonOk : false)

  function submit() {
    if (busy.current || !canSubmit) return
    busy.current = true
    setError(null)
    const decision = mode === 'approve' ? 'reconciled' : 'rejected'
    startTransition(async () => {
      try {
        const r = await reconcilePayment({ paymentId: facts.paymentId, decision, notes, confirmFundsReceived: mode === 'approve' ? funds : false })
        if (!r.ok) { setError(r.error); busy.current = false; return }
        setDone({ status: r.status, endDate: r.endDate })
        router.refresh() // el pago deja de estar pendiente: se recarga el detalle desde el servidor
      } catch {
        setError('No se pudo completar la operación (¿sin conexión?). Recargá la página y verificá el estado del pago antes de reintentar.')
        busy.current = false
      }
    })
  }

  if (done) {
    return (
      <div role="status" className={`${card} mt-5 border-[var(--oc-brand)] p-5`}>
        <h2 className="font-bold">{done.status === 'reconciled' ? 'Transferencia aprobada' : 'Transferencia rechazada'}</h2>
        <p className="mt-1 text-sm">
          {done.status === 'reconciled'
            ? `La suscripción quedó activa${done.endDate ? ` hasta el ${done.endDate.split('-').reverse().join('/')}` : ''}. La decisión quedó registrada en el historial.`
            : 'El pago quedó rechazado y la suscripción no se modificó. El motivo quedó registrado en el historial.'}
        </p>
      </div>
    )
  }

  return (
    <section aria-labelledby="td-title" className={`${card} mt-5 p-5`}>
      <h2 id="td-title" className="font-bold">Transferencia pendiente de revisión</h2>
      <p className="mt-1 text-sm text-[var(--oc-muted)]">
        Verificá en la cuenta bancaria que el dinero efectivamente ingresó. Aprobar activa o extiende la suscripción
        {facts.planLabel ? ` (plan ${facts.planLabel})` : ''}{facts.currentEndLabel ? `; vigencia actual hasta ${facts.currentEndLabel}` : ''}. No se puede deshacer desde esta pantalla.
      </p>
      <ul className="mt-3 grid gap-1 text-sm">
        <li><span className="text-[var(--oc-muted)]">Usuario:</span> <strong>{facts.userLabel}</strong></li>
        <li><span className="text-[var(--oc-muted)]">Importe informado:</span> <strong>{facts.amountLabel}</strong></li>
        <li><span className="text-[var(--oc-muted)]">Referencia / nº de operación:</span> <strong>{facts.reference ?? 'No informada'}</strong></li>
        <li><span className="text-[var(--oc-muted)]">Comprobante:</span> {facts.proofUrl ? <a className="font-semibold text-[var(--oc-brand)] hover:underline" href={facts.proofUrl} target="_blank" rel="noopener noreferrer">abrir comprobante</a> : <strong>No adjuntado</strong>}</li>
      </ul>

      {mode === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => { setMode('approve'); setError(null) }} className={btnCls}>Aprobar…</button>
          <button type="button" onClick={() => { setMode('reject'); setError(null) }} className={btnGhost}>Rechazar…</button>
        </div>
      )}

      {mode === 'approve' && (
        <div className="mt-4 grid gap-3 rounded-xl border border-[var(--oc-border)] p-4">
          <p className="text-sm font-bold">Confirmar aprobación</p>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={funds} onChange={(e) => setFunds(e.target.checked)} className="mt-0.5 size-5" />
            <span>Confirmo que en la cuenta bancaria ingresaron <strong>{facts.amountLabel}</strong> de <strong>{facts.userLabel}</strong>{facts.reference ? ` (ref. ${facts.reference})` : ''}.</span>
          </label>
          <label className="grid gap-1 text-sm font-semibold">Nota interna (opcional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} className={inputCls} placeholder="Ej.: ingresó el 12/11, banco X" />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={!canSubmit} onClick={submit} className={`${btnCls} disabled:opacity-50`}>{pending ? 'Aprobando…' : 'Confirmar aprobación'}</button>
            <button type="button" disabled={pending} onClick={() => { setMode('idle'); setFunds(false) }} className={btnGhost}>Cancelar</button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="mt-4 grid gap-3 rounded-xl border border-[var(--oc-border)] p-4">
          <p className="text-sm font-bold">Confirmar rechazo</p>
          <label className="grid gap-1 text-sm font-semibold">Motivo del rechazo (obligatorio)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={3} className={inputCls} aria-invalid={notes.length > 0 && !reasonOk} placeholder="Ej.: no figura el ingreso en el banco" />
            {notes.length > 0 && !reasonOk && <span role="alert" className="text-xs font-semibold text-[var(--oc-coral)]">Mínimo {MIN_REJECT_REASON} caracteres.</span>}
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={!canSubmit} onClick={submit} className={`${btnCls} disabled:opacity-50`}>{pending ? 'Rechazando…' : 'Confirmar rechazo'}</button>
            <button type="button" disabled={pending} onClick={() => { setMode('idle'); setNotes('') }} className={btnGhost}>Cancelar</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-xl bg-[var(--oc-danger-bg)] px-4 py-3 text-sm font-semibold text-[var(--oc-coral)]">{error}</p>}
    </section>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { ArrowLeft } from 'lucide-react'
import { deleteQuote, setQuoteStatus } from '@/lib/actions/quotes'
import { reopenQuote } from '@/lib/actions/quoteBuilder'
import { invalidate } from '@/lib/cache/store'
import { QUOTE_STATUS_LABEL, lineSubtotal, quoteNumberLabel, type QuoteForEdit } from '@/lib/quotes'
import { card, coralBtn, errText, ghostBtn, money, primaryBtn } from './ui'

// Vista de un presupuesto ya guardado (borrador listo para enviar, enviado, aceptado o rechazado).
// Los importes son los que se guardaron al presupuestar: no se recalculan con precios actuales.

export function QuoteReadOnly({ data, onBack, onEdit, onChanged, onSchedule, onOpenJob }: {
  data: QuoteForEdit; onBack: () => void; onEdit: () => void; onChanged: () => void
  onSchedule?: (quoteId: string) => void; onOpenJob?: (jobId: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const q = data

  function run(fn: () => Promise<{ error?: string } | void | { ok: true }>, after: 'reload' | 'back' = 'reload') {
    setError(null)
    startTransition(async () => {
      try {
        const r = await fn()
        if (r && 'error' in r && r.error) { setError(r.error); return }
        await invalidate('quotes:')
        if (after === 'back') onBack(); else onChanged()
      } catch { setError('No se pudo completar la acción. Revisá tu conexión e intentá de nuevo.') }
    })
  }

  function sendWhatsapp() {
    const phone = q.customer?.phone?.replace(/\D/g, '')
    const text = [
      `Presupuesto ${quoteNumberLabel(q.number)}`,
      `Cliente: ${q.customer?.name ?? ''}`,
      '',
      ...q.lines.map((l, i) => `${i + 1}. ${l.description} x${l.quantity} — ${money(lineSubtotal(l.quantity, l.unitPrice))}`),
      '',
      `TOTAL: ${money(q.total)}`,
      q.notes ? `\nObservaciones: ${q.notes}` : '',
    ].join('\n')
    window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    if (q.status === 'draft') run(() => setQuoteStatus(q.id, q.customer?.id ?? null, 'sent'))
  }

  return (
    <div className="mx-auto max-w-[860px] p-5 pb-28 md:p-8">
      <button type="button" onClick={onBack} className="mb-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--oc-brand)]"><ArrowLeft className="size-4" aria-hidden="true" />Volver a presupuestos</button>
      <h1 className="text-2xl font-bold text-[var(--oc-ink)]">Presupuesto {quoteNumberLabel(q.number)}</h1>
      <p className="mt-1 text-sm text-[var(--oc-muted)]">{q.customer?.name ?? 'Sin cliente'} · {QUOTE_STATUS_LABEL[q.status] ?? q.status}</p>

      {q.job && (
        <p className="mt-3 rounded-xl bg-[var(--oc-surface-soft)] px-4 py-3 text-sm">
          Vinculado al trabajo “{q.job.description}”.{' '}
          {onOpenJob && <button type="button" onClick={() => onOpenJob(q.job!.id)} className="min-h-11 font-bold text-[var(--oc-brand)] underline">Ver en la agenda</button>}
        </p>
      )}

      <section className={`mt-5 ${card}`}>
        <h2 className="font-bold text-[var(--oc-ink)]">Detalle</h2>
        {q.lines.length === 0 ? <p className="mt-3 text-sm text-[var(--oc-muted)]">Este presupuesto no tiene líneas.</p> : (
          <ul className="mt-3 flex flex-col divide-y divide-[var(--oc-border-soft)]">
            {q.lines.map((l) => (
              <li key={l.key} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1"><p className="break-words font-semibold text-[var(--oc-ink)]">{l.description}</p><p className="text-xs text-[var(--oc-muted)]">{l.quantity} × {money(l.unitPrice)}{l.unitLabel ? ` · ${l.unitLabel}` : ''}</p></div>
                <p className="shrink-0 font-bold text-[var(--oc-brand)]">{money(lineSubtotal(l.quantity, l.unitPrice))}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex items-center justify-between border-t border-[var(--oc-border-soft)] pt-4"><p className="font-bold text-[var(--oc-ink)]">Total</p><p className="text-xl font-bold text-[var(--oc-brand)]">{money(q.total)}</p></div>
        {q.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--oc-muted)]">Observaciones: {q.notes}</p>}
      </section>

      {error && <p role="alert" className={`mt-4 ${errText} text-sm`}>{error}</p>}

      <div className="mt-5 flex flex-col gap-3">
        {q.status === 'accepted' && onSchedule && <button type="button" onClick={() => (q.job && onOpenJob ? onOpenJob(q.job.id) : onSchedule(q.id))} className={coralBtn}>{q.job ? 'Ver el trabajo en la agenda' : 'Programar trabajo'}</button>}
        {q.status === 'sent' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={pending} onClick={() => run(() => setQuoteStatus(q.id, q.customer?.id ?? null, 'accepted'))} className={ghostBtn}>Marcar aceptado</button>
            <button type="button" disabled={pending} onClick={() => run(() => setQuoteStatus(q.id, q.customer?.id ?? null, 'rejected'))} className={ghostBtn}>Marcar rechazado</button>
          </div>
        )}
        {(q.status === 'sent' || q.status === 'rejected') && (
          <button type="button" disabled={pending} onClick={() => run(() => reopenQuote(q.id))} className={ghostBtn}>Volver a borrador para corregirlo</button>
        )}
        {q.status === 'draft' && <button type="button" onClick={onEdit} className={primaryBtn}>Editar presupuesto</button>}
        {q.lines.length > 0 && <button type="button" onClick={sendWhatsapp} disabled={pending} className="min-h-11 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{q.status === 'draft' ? 'Enviar por WhatsApp' : 'Reenviar por WhatsApp'}</button>}
        {q.status === 'draft' && (confirmDelete ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--oc-border)] p-3 text-sm">
            <span className="font-semibold">¿Borrar este borrador? No se puede deshacer.</span>
            <button type="button" disabled={pending} onClick={() => run(async () => (await deleteQuote(q.id)) ?? {}, 'back')} className={coralBtn}>Sí, borrar</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className={ghostBtn}>Cancelar</button>
          </div>
        ) : <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-11 text-sm font-bold text-[var(--oc-coral)]">Borrar borrador</button>)}
      </div>
    </div>
  )
}

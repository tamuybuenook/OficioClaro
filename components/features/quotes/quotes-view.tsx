'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  fetchMyQuotes, fetchQuoteDetail, createQuote, addQuoteItem,
  updateQuoteItemQuantity, removeQuoteItem, deleteQuote, setQuoteStatus,
} from '@/lib/actions/quotes'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { fetchJobForQuote } from '@/lib/actions/agenda'
import type { Job } from '@/components/types'

const statusLabel: Record<string, string> = { draft: 'Borrador', sent: 'Enviado', accepted: 'Aceptado', rejected: 'Rechazado' }
const money = (v: number) => `$${Number(v).toLocaleString('es-AR')}`

type Customer = { id: string; name: string; phone: string | null }

export function QuotesView({ customers, jobs, onSchedule }: { customers: Customer[]; jobs: Job[]; onSchedule?: (quoteId: string) => void }) {
  const [quotes, setQuotes] = useState<any[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function reload() { setQuotes(await fetchMyQuotes()) }
  useEffect(() => { reload() }, [])

  function newQuote() {
    if (customers.length === 0) { window.alert('Primero cargá al menos un cliente en "Mis clientes".'); return }
    const names = customers.map((c, i) => `${i + 1}. ${c.name}`).join('\n')
    const pick = window.prompt(`¿Para qué cliente es el presupuesto?\n${names}\n\nEscribí el número:`)
    const idx = Number(pick) - 1
    const customer = customers[idx]
    if (!customer) return
    startTransition(async () => {
      const res = await createQuote(customer.id)
      if ('data' in res) { await reload(); setOpenId(res.data.id) }
    })
  }

  if (openId) return <QuoteDetail quoteId={openId} jobs={jobs} onSchedule={onSchedule} onBack={() => { setOpenId(null); reload() }} />

  return (
    <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8">
      <div className="flex items-start justify-between">
        <div><p className="text-sm text-[var(--oc-muted)]">Preparar y comunicar trabajos a tus clientes</p><h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Presupuestos</h1></div>
        <button onClick={newQuote} disabled={pending} className="rounded-xl bg-[var(--oc-coral)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">+ Nuevo presupuesto</button>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {quotes === null && <p className="text-sm text-[var(--oc-muted)]">Cargando…</p>}
        {quotes?.length === 0 && <p className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5 text-sm text-[var(--oc-muted)]">Todavía no creaste presupuestos.</p>}
        {quotes?.map((q: any) => (
          <button key={q.id} onClick={() => setOpenId(q.id)} className="flex items-center justify-between rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4 text-left">
            <div><p className="font-bold text-[var(--oc-ink)]">Presupuesto Nº {String(q.number ?? '?').padStart(5, '0')}</p><p className="text-xs text-[var(--oc-muted)]">{q.customers?.name ?? 'Sin cliente'} · {new Date(q.created_at).toLocaleDateString('es-AR')}</p></div>
            <div className="text-right"><p className="font-bold text-[var(--oc-brand)]">{money(q.total)}</p><p className="text-xs text-[var(--oc-muted)]">{statusLabel[q.status] ?? q.status}</p></div>
          </button>
        ))}
      </div>
    </div>
  )
}

function QuoteDetail({ quoteId, jobs, onBack, onSchedule }: { quoteId: string; jobs: Job[]; onBack: () => void; onSchedule?: (quoteId: string) => void }) {
  const [data, setData] = useState<{ quote: any; items: any[] } | null>(null)
  const [hasJob, setHasJob] = useState(false) // ¿ya hay un trabajo activo agendado para este presupuesto?
  const [pending, startTransition] = useTransition()

  async function reload() {
    const detail = await fetchQuoteDetail(quoteId)
    setData(detail)
    if (detail.quote.status === 'accepted') {
      const job = await fetchJobForQuote(quoteId).catch(() => null)
      setHasJob(!!job?.data)
    } else setHasJob(false)
  }
  useEffect(() => { reload() }, [quoteId])

  if (!data) return <div className="mx-auto max-w-[1040px] p-5">Cargando…</div>
  const { quote, items } = data

  function addItem() {
    const names = jobs.map((j, i) => `${i + 1}. ${j.name}`).join('\n')
    const pick = window.prompt(`¿Qué trabajo agregás?\n${names}\n\nEscribí el número:`)
    const job = jobs[Number(pick) - 1]
    if (!job) return
    const qty = Number(window.prompt('Cantidad', '1') || '1')
    startTransition(async () => { await addQuoteItem(quoteId, job.id, qty); reload() })
  }

  function sendWhatsapp() {
    const phone = quote.customers?.phone?.replace(/\D/g, '')
    const lines = items.map((it: any, i: number) => `${i + 1}. ${it.description ?? it.services?.name} x${it.quantity} — ${money(it.subtotal)}`)
    const text = [
      `Presupuesto Nº ${String(quote.number ?? '?').padStart(5, '0')}`,
      `Cliente: ${quote.customers?.name ?? ''}`,
      '',
      ...lines,
      '',
      `TOTAL: ${money(quote.total)}`,
      quote.notes ? `\nObservaciones: ${quote.notes}` : '',
    ].join('\n')
    const url = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, '_blank')
    startTransition(async () => { await setQuoteStatus(quoteId, quote.customer_id, 'sent'); reload() })
  }

  return (
    <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8">
      <button onClick={onBack} className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--oc-brand)]"><ArrowLeft className="size-4" />Volver a presupuestos</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-[var(--oc-ink)]">Presupuesto Nº {String(quote.number ?? '?').padStart(5, '0')}</h1><p className="mt-1 text-sm text-[var(--oc-muted)]">{quote.customers?.name ?? 'Sin cliente'} · {statusLabel[quote.status] ?? quote.status}</p></div>
        <div className="flex gap-2">
          {quote.status === 'draft' && <button onClick={() => startTransition(async () => { await deleteQuote(quoteId); onBack() })} className="rounded-lg border border-[var(--oc-border)] px-3 py-2 text-xs font-bold text-[var(--oc-coral)]">Borrar</button>}
          {quote.status === 'sent' && <>
            <button onClick={() => startTransition(async () => { await setQuoteStatus(quoteId, quote.customer_id, 'accepted'); reload() })} className="rounded-lg border border-[var(--oc-border)] px-3 py-2 text-xs font-bold text-[var(--oc-success-text)]">Marcar aceptado</button>
            <button onClick={() => startTransition(async () => { await setQuoteStatus(quoteId, quote.customer_id, 'rejected'); reload() })} className="rounded-lg border border-[var(--oc-border)] px-3 py-2 text-xs font-bold text-[var(--oc-coral)]">Marcar rechazado</button>
          </>}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
        <div className="flex items-center justify-between"><h2 className="font-bold text-[var(--oc-ink)]">Ítems</h2><button onClick={addItem} disabled={pending} className="rounded-lg bg-[var(--oc-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">+ Agregar trabajo</button></div>
        <div className="mt-4 flex flex-col divide-y divide-[var(--oc-border-soft)]">
          {items.length === 0 && <p className="py-3 text-sm text-[var(--oc-muted)]">Todavía no agregaste trabajos.</p>}
          {items.map((it: any) => (
            <div key={it.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1"><p className="truncate font-semibold text-[var(--oc-ink)]">{it.description ?? it.services?.name}</p><p className="text-xs text-[var(--oc-muted)]">{money(it.unit_price)} c/u</p></div>
              <input type="number" min={1} defaultValue={it.quantity} onBlur={(e) => startTransition(async () => { await updateQuoteItemQuantity(it.id, quoteId, Number(e.target.value) || 1); reload() })} className="w-16 rounded-lg border border-[var(--oc-border)] p-1.5 text-center text-sm" />
              <p className="w-24 text-right font-bold text-[var(--oc-brand)]">{money(it.subtotal)}</p>
              <button onClick={() => startTransition(async () => { await removeQuoteItem(it.id, quoteId); reload() })}><Trash2 className="size-4 text-[var(--oc-coral)]" /></button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-[var(--oc-border-soft)] pt-4"><p className="font-bold text-[var(--oc-ink)]">Total</p><p className="text-xl font-bold text-[var(--oc-brand)]">{money(quote.total)}</p></div>
      </div>

      {quote.status === 'accepted' && onSchedule && (
        <button type="button" onClick={() => onSchedule(quoteId)} className="mt-4 min-h-11 w-full rounded-xl bg-[var(--oc-coral)] px-4 py-3 text-sm font-bold text-white">
          {hasJob ? 'Ver el trabajo en la agenda' : 'Programar trabajo'}
        </button>
      )}

      <button onClick={sendWhatsapp} disabled={items.length === 0} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">Enviar por WhatsApp</button>
    </div>
  )
}

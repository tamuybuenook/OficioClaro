'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchCustomerById, fetchQuoteForEdit, fetchQuoteList, type QuoteListRow } from '@/lib/actions/quoteBuilder'
import { fetchAgendaJob } from '@/lib/actions/agenda'
import { useCachedQuery } from '@/lib/cache/use-cached-query'
import { QUOTE_STATUS_LABEL, quoteNumberLabel, type CustomerOption, type QuoteForEdit } from '@/lib/quotes'
import type { QuoteIntent } from '@/components/types'
import { QuoteEditor, type EditorInitial } from './quote-editor'
import { QuoteReadOnly } from './quote-readonly'
import { coralBtn, errText, ghostBtn, money } from './ui'

type Screen =
  | { kind: 'list' }
  | { kind: 'new'; customerId: string | null; jobId: string | null; nonce: number }
  | { kind: 'quote'; quoteId: string }

export function QuotesView({ intent, onIntentHandled, onSchedule, onBackToAgenda, onOpenJob }: {
  intent?: QuoteIntent | null
  onIntentHandled?: () => void
  onSchedule?: (quoteId: string) => void
  onBackToAgenda?: (jobId: string) => void
  onOpenJob?: (jobId: string) => void
}) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })

  // Pedidos que llegan desde Clientes o Agenda: solo abren el formulario; no crean nada hasta guardar.
  useEffect(() => {
    if (!intent) return
    if (intent.kind === 'new') setScreen({ kind: 'new', customerId: intent.customerId ?? null, jobId: intent.jobId ?? null, nonce: Date.now() })
    else setScreen({ kind: 'quote', quoteId: intent.quoteId })
    onIntentHandled?.()
  }, [intent, onIntentHandled])

  if (screen.kind === 'new') {
    return <QuoteScreen key={`new-${screen.nonce}`} target={{ kind: 'new', customerId: screen.customerId, jobId: screen.jobId }}
      onBack={() => setScreen({ kind: 'list' })} onSaved={(id) => setScreen({ kind: 'quote', quoteId: id })}
      onSchedule={onSchedule} onBackToAgenda={onBackToAgenda} onOpenJob={onOpenJob} />
  }
  if (screen.kind === 'quote') {
    return <QuoteScreen key={screen.quoteId} target={{ kind: 'open', quoteId: screen.quoteId }}
      onBack={() => setScreen({ kind: 'list' })} onSaved={(id) => setScreen({ kind: 'quote', quoteId: id })}
      onSchedule={onSchedule} onBackToAgenda={onBackToAgenda} onOpenJob={onOpenJob} />
  }
  return <QuotesList onNew={() => setScreen({ kind: 'new', customerId: null, jobId: null, nonce: Date.now() })} onOpen={(id) => setScreen({ kind: 'quote', quoteId: id })} />
}

function QuotesList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const [pages, setPages] = useState(1)
  return (
    <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm text-[var(--oc-muted)]">Preparar y comunicar trabajos a tus clientes</p><h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Presupuestos</h1></div>
        <button type="button" onClick={onNew} className={coralBtn}>+ Nuevo presupuesto</button>
      </div>
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: pages }, (_, i) => <QuotesPage key={i} page={i + 1} last={i + 1 === pages} onMore={() => setPages((p) => p + 1)} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

function QuotesPage({ page, last, onMore, onOpen }: { page: number; last: boolean; onMore: () => void; onOpen: (id: string) => void }) {
  const { data, loading, refreshing, error, reload } = useCachedQuery<{ items: QuoteListRow[]; total: number; pageSize: number }>(
    'quotes:list', { page },
    async () => { const r = await fetchQuoteList(page); return 'error' in r ? { error: r.error } : r },
    { ttlMs: 60_000 },
  )
  if (loading && !data) return <p className="text-sm text-[var(--oc-muted)]" role="status">Cargando…</p>
  if (error && !data) return <div><p role="alert" className={errText}>{error}</p><button type="button" onClick={reload} className="min-h-11 text-sm font-bold text-[var(--oc-brand)] underline">Reintentar</button></div>
  if (!data) return null
  if (data.items.length === 0 && page === 1) return <p className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5 text-sm text-[var(--oc-muted)]">Todavía no creaste presupuestos. Tocá “Nuevo presupuesto” o usá “Presupuestar” desde un cliente.</p>
  return (
    <>
      {error && <p role="status" className="text-xs text-[var(--oc-muted)]">Mostrando datos guardados en tu dispositivo.</p>}
      {data.items.map((q) => (
        <button key={q.id} type="button" onClick={() => onOpen(q.id)} className={`flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4 text-left ${refreshing ? 'opacity-80' : ''}`}>
          <div className="min-w-0"><p className="font-bold text-[var(--oc-ink)]">Presupuesto {quoteNumberLabel(q.number)}</p><p className="truncate text-xs text-[var(--oc-muted)]">{q.customerName ?? 'Sin cliente'} · {new Date(q.created_at).toLocaleDateString('es-AR')}</p></div>
          <div className="shrink-0 text-right"><p className="font-bold text-[var(--oc-brand)]">{money(q.total)}</p><p className="text-xs text-[var(--oc-muted)]">{QUOTE_STATUS_LABEL[q.status] ?? q.status}</p></div>
        </button>
      ))}
      {last && data.total > page * data.pageSize && <button type="button" onClick={onMore} className={ghostBtn}>Ver presupuestos anteriores</button>}
    </>
  )
}

type Target = { kind: 'new'; customerId: string | null; jobId: string | null } | { kind: 'open'; quoteId: string }
type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; quote: QuoteForEdit | null; customer: CustomerOption | null; jobId: string | null; jobLabel: string | null; lockCustomer: boolean }

/** Carga lo necesario (presupuesto, cliente, trabajo) y decide entre el editor (borrador) y la vista (resto). */
function QuoteScreen({ target, onBack, onSaved, onSchedule, onBackToAgenda, onOpenJob }: {
  target: Target; onBack: () => void; onSaved: (id: string) => void
  onSchedule?: (quoteId: string) => void; onBackToAgenda?: (jobId: string) => void; onOpenJob?: (jobId: string) => void
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [editing, setEditing] = useState(target.kind === 'new')
  const [attempt, setAttempt] = useState(0)

  const load = useCallback(async () => {
    try {
      if (target.kind === 'open') {
        const r = await fetchQuoteForEdit(target.quoteId)
        if ('error' in r) { setLoaded({ state: 'error', message: r.error }); return }
        setLoaded({ state: 'ready', quote: r.data, customer: r.data.customer, jobId: r.data.job?.id ?? null, jobLabel: r.data.job?.description ?? null, lockCustomer: !!r.data.job })
        return
      }
      let customer: CustomerOption | null = null
      let jobLabel: string | null = null
      let lock = false
      let customerId = target.customerId
      if (target.jobId) {
        const j = await fetchAgendaJob(target.jobId)
        if (j.error || !j.data) { setLoaded({ state: 'error', message: j.error ?? 'No se pudo abrir el trabajo.' }); return }
        jobLabel = j.data.description
        if (j.data.customer_id) { customerId = j.data.customer_id; lock = true }
      }
      if (customerId) {
        const c = await fetchCustomerById(customerId)
        if ('error' in c) { setLoaded({ state: 'error', message: c.error }); return }
        customer = c.data
      }
      setLoaded({ state: 'ready', quote: null, customer, jobId: target.jobId, jobLabel, lockCustomer: lock })
    } catch {
      setLoaded({ state: 'error', message: 'No se pudo abrir el presupuesto. Revisá tu conexión e intentá de nuevo.' })
    }
  }, [target])

  useEffect(() => { setLoaded({ state: 'loading' }); void load() }, [load, attempt])

  if (loaded.state === 'loading') return <div className="mx-auto max-w-[860px] p-5 text-sm text-[var(--oc-muted)]" role="status">Cargando…</div>
  if (loaded.state === 'error') {
    return (
      <div className="mx-auto max-w-[860px] p-5">
        <p role="alert" className={`${errText} text-sm`}>{loaded.message}</p>
        <div className="mt-3 flex gap-2"><button type="button" onClick={() => setAttempt((n) => n + 1)} className={ghostBtn}>Reintentar</button><button type="button" onClick={onBack} className={ghostBtn}>Volver</button></div>
      </div>
    )
  }

  const q = loaded.quote
  if (q && (!editing || q.status !== 'draft')) {
    return <QuoteReadOnly data={q} onBack={onBack} onEdit={() => setEditing(true)} onChanged={() => setAttempt((n) => n + 1)} onSchedule={onSchedule} onOpenJob={onOpenJob} />
  }
  const initial: EditorInitial = { quote: q, customer: loaded.customer, jobId: loaded.jobId, jobLabel: loaded.jobLabel, lockCustomer: loaded.lockCustomer }
  return <QuoteEditor initial={initial} onClose={q ? () => setEditing(false) : onBack} onSaved={onSaved} onBackToAgenda={onBackToAgenda} />
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import {
  fetchAgenda, fetchAgendaCustomers, fetchAgendaJob, fetchQuoteScheduleDraft,
} from '@/lib/actions/agenda'
import {
  ACTIVE_STATUSES, addDays, compareJobs, countByDate, dayNumber, formatDayLong, formatWeekRange,
  groupByDate, isValidDate, relativeDayLabel, startOfWeek, todayISO, weekDays, weekdayShort,
  type AgendaJob,
} from '@/lib/agenda'
import type { AgendaIntent } from '@/components/types'
import { AgendaHelp } from './agenda-help'
import { AgendaJobCard } from './agenda-job-card'
import { AgendaJobForm, type AgendaCustomer, type JobFormInitial } from './agenda-job-form'

const HELP_SEEN_KEY = 'oc-agenda-help-seen' // solo recuerda que ya viste la ayuda; no es un dato del negocio
const AGENDA_WINDOW_DAYS = 60

type AgendaData = { jobs: AgendaJob[]; unscheduled: AgendaJob[]; overdue: AgendaJob[] }
type Notice = { tone: 'ok' | 'error'; text: string }

const pad = (n: number | null) => String(n ?? '?').padStart(5, '0')

function toInitial(job: AgendaJob): JobFormInitial {
  return {
    id: job.id, customer_id: job.customer_id, quote_id: job.quote_id, description: job.description,
    job_date: job.job_date, start_time: job.start_time, duration_minutes: job.duration_minutes,
    address: job.address, notes: job.notes, status: job.status,
  }
}

const primaryBtn = 'min-h-11 rounded-xl bg-[var(--oc-coral)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60'
const ghostBtn = 'min-h-11 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-4 py-2.5 text-sm font-bold text-[var(--oc-brand)] disabled:opacity-60'

export function AgendaView({
  intent, onIntentHandled, onOpenClient, onQuote,
}: {
  intent: AgendaIntent | null
  onIntentHandled: () => void
  onOpenClient: (customerId: string) => void
  onQuote?: (c: { jobId: string | null; customerId: string | null; quoteId?: string | null }) => void
}) {
  const [today] = useState(() => todayISO()) // hora local del dispositivo (no la del servidor)
  const [mode, setMode] = useState<'agenda' | 'week'>('agenda')
  const [anchor, setAnchor] = useState(today)
  const [selectedDay, setSelectedDay] = useState(today)
  const [showClosed, setShowClosed] = useState(false)
  const [data, setData] = useState<AgendaData | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [customers, setCustomers] = useState<AgendaCustomer[] | null>(null)
  const [form, setForm] = useState<{ initial: JobFormInitial; quoteLabel: string | null } | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const requestId = useRef(0)

  const range = useMemo(() => {
    if (mode === 'week') { const from = startOfWeek(anchor); return { from, to: addDays(from, 6) } }
    return { from: anchor, to: addDays(anchor, AGENDA_WINDOW_DAYS) }
  }, [mode, anchor])

  // ---- carga de datos (se ignoran respuestas viejas si el usuario ya cambió de fecha)
  useEffect(() => {
    const id = ++requestId.current
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetchAgenda(range.from, range.to, today)
        if (id !== requestId.current) return
        if (res.error || !res.data) setLoadError(res.error ?? 'No se pudo cargar la agenda.')
        else { setLoadError(null); setData(res.data) }
      } catch {
        if (id === requestId.current) setLoadError('No se pudo cargar la agenda. Revisá tu conexión e intentá de nuevo.')
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    })()
  }, [range.from, range.to, today, version])

  useEffect(() => {
    let alive = true
    fetchAgendaCustomers()
      .then((res) => {
        if (!alive) return
        if (res.error || !res.data) { setCustomers([]); setNotice({ tone: 'error', text: res.error ?? 'No se pudieron cargar tus clientes.' }) }
        else setCustomers(res.data)
      })
      .catch(() => { if (alive) { setCustomers([]); setNotice({ tone: 'error', text: 'No se pudieron cargar tus clientes. Revisá tu conexión.' }) } })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    try { if (!window.localStorage.getItem(HELP_SEEN_KEY)) setHelpOpen(true) } catch { /* sin storage: la ayuda queda en el botón */ }
  }, [])

  function closeHelp() {
    setHelpOpen(false)
    try { window.localStorage.setItem(HELP_SEEN_KEY, '1') } catch { /* no es crítico */ }
  }

  // ---- pedidos que llegan desde Clientes o Presupuestos: solo abren el formulario, no crean nada
  useEffect(() => {
    if (!intent || customers === null) return
    const current = intent
    onIntentHandled()
    ;(async () => {
      try {
        if (current.kind === 'new') {
          const c = customers.find((x) => x.id === current.customerId)
          setForm({ initial: { customer_id: c?.id ?? null, address: c?.address ?? null }, quoteLabel: null })
        } else if (current.kind === 'from-quote') {
          const res = await fetchQuoteScheduleDraft(current.quoteId)
          if (res.error || !res.data) { setNotice({ tone: 'error', text: res.error ?? 'No se pudo abrir el presupuesto.' }); return }
          const { quote, prefill, existing } = res.data
          const label = `presupuesto Nº ${pad(quote.number)}`
          if (existing) {
            setNotice({ tone: 'ok', text: 'Este presupuesto ya tiene un trabajo agendado. Lo abrimos para que lo edites o reprogrames: no se crea otro.' })
            setForm({ initial: toInitial(existing), quoteLabel: label })
            return
          }
          setForm({
            initial: { quote_id: quote.id, customer_id: quote.customer_id, description: prefill.description, address: prefill.address, notes: prefill.notes },
            quoteLabel: label,
          })
        } else {
          const res = await fetchAgendaJob(current.jobId)
          if (res.error || !res.data) { setNotice({ tone: 'error', text: res.error ?? 'No se pudo abrir el trabajo.' }); return }
          const job = res.data
          setForm(null)
          setMode('agenda')
          if (job.status === 'done' || job.status === 'cancelled') setShowClosed(true)
          if (job.job_date) { setAnchor(job.job_date); setSelectedDay(job.job_date) }
          setHighlightId(job.id)
          setVersion((v) => v + 1)
        }
      } catch {
        setNotice({ tone: 'error', text: 'No se pudo abrir la agenda. Revisá tu conexión e intentá de nuevo.' })
      }
    })()
  }, [intent, customers, onIntentHandled])

  useEffect(() => {
    if (!highlightId || !data) return
    document.getElementById(`job-${highlightId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlightId, data])

  // ---- acciones
  const visible = useCallback((jobs: AgendaJob[]) => (showClosed ? jobs : jobs.filter((j) => ACTIVE_STATUSES.includes(j.status))), [showClosed])

  function goToday() { setAnchor(today); setSelectedDay(today) }
  function shift(days: number) { setAnchor(addDays(anchor, days)); setSelectedDay(addDays(selectedDay, days)) }
  function pickDate(v: string) { if (isValidDate(v)) { setAnchor(v); setSelectedDay(v) } }
  function switchMode(next: 'agenda' | 'week') {
    if (next === mode) return
    if (next === 'week') setSelectedDay(anchor)
    else setAnchor(selectedDay)
    setMode(next)
  }
  function openNew(date?: string) {
    setForm({ initial: date ? { job_date: date, status: 'scheduled' } : {}, quoteLabel: null })
  }
  function onSaved(job: AgendaJob, info: { duplicate: boolean; created: boolean; quote?: boolean }) {
    setForm(null)
    if (info.quote && onQuote) { // "Guardar y armar presupuesto": el trabajo ya quedó guardado; se abre el presupuesto con su cliente
      onQuote({ jobId: job.id, customerId: job.customer_id })
      return
    }
    setNotice({
      tone: 'ok',
      text: info.duplicate ? 'Este presupuesto ya tenía un trabajo agendado: te mostramos ese, no se creó otro.' : info.created ? 'Trabajo guardado en la agenda.' : 'Cambios guardados.',
    })
    if (job.job_date) { setAnchor(job.job_date); setSelectedDay(job.job_date) }
    if (job.status === 'done' || job.status === 'cancelled') setShowClosed(true)
    setHighlightId(job.id)
    setVersion((v) => v + 1)
  }
  function onChanged(job: AgendaJob, message: string) {
    setNotice({ tone: 'ok', text: message })
    setHighlightId(job.id)
    setVersion((v) => v + 1)
  }

  // ---- formulario
  if (form) {
    return (
      <AgendaJobForm
        key={form.initial.id ?? 'new'}
        initial={form.initial}
        customers={customers ?? []}
        quoteLabel={form.quoteLabel}
        defaultDate={mode === 'week' ? selectedDay : anchor < today ? today : anchor}
        onSaved={onSaved}
        onCancel={() => setForm(null)}
        onQuote={onQuote ? (c) => onQuote(c) : undefined}
      />
    )
  }

  // ---- derivados
  const visibleJobs = data ? visible(data.jobs) : []
  const groups = groupByDate(visibleJobs)
  const unscheduled = data ? visible(data.unscheduled) : []
  const inRange = new Set((data?.jobs ?? []).map((j) => j.id))
  const overdue = mode === 'agenda' && data ? data.overdue.filter((j) => !inRange.has(j.id)) : []
  const days = weekDays(anchor)
  const counts = countByDate(data?.jobs ?? [])
  const dayJobs = visibleJobs.filter((j) => j.job_date === selectedDay).sort(compareJobs)
  const nothingAtAll = data && groups.length === 0 && unscheduled.length === 0 && overdue.length === 0

  const card = (job: AgendaJob, showDate = false) => (
    <AgendaJobCard key={job.id} job={job} showDate={showDate} highlighted={job.id === highlightId}
      onEdit={(j) => setForm({ initial: toInitial(j), quoteLabel: j.quote_id ? 'presupuesto de origen' : null })}
      onChanged={onChanged} onOpenClient={onOpenClient} />
  )

  return (
    <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-sm text-[var(--oc-muted)]">Tus trabajos y compromisos</p><h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Agenda</h1></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => (helpOpen ? closeHelp() : setHelpOpen(true))} aria-expanded={helpOpen} className={ghostBtn}>{helpOpen ? 'Cerrar ayuda' : 'Ayuda'}</button>
          <button type="button" onClick={() => openNew(mode === 'week' ? selectedDay : undefined)} disabled={customers === null} className={primaryBtn}>+ Nuevo trabajo</button>
        </div>
      </div>

      {helpOpen && <AgendaHelp onClose={closeHelp} />}

      {notice && (
        <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`mt-4 flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${notice.tone === 'error' ? 'bg-[var(--oc-danger-bg)] text-[var(--oc-coral)]' : 'bg-[var(--oc-success-bg)] text-[var(--oc-success-text)]'}`}>
          <span className="min-w-0 break-words">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="min-h-11 shrink-0 px-2 text-sm font-bold underline">Cerrar</button>
        </div>
      )}

      {/* Modo y navegación */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Tipo de vista" className="inline-flex rounded-full border border-[var(--oc-border)] bg-[var(--oc-surface)] p-1">
          {(['agenda', 'week'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)}
              className={`min-h-11 rounded-full px-4 text-sm font-bold ${mode === m ? 'bg-[var(--oc-brand)] text-white' : 'text-[var(--oc-muted)]'}`}>{m === 'agenda' ? 'Agenda' : 'Semana'}</button>
          ))}
        </div>
        <label className="ml-auto flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--oc-muted)]">
          <span>Ir a</span>
          <input type="date" value={mode === 'week' ? selectedDay : anchor} onChange={(e) => pickDate(e.target.value)} className="min-h-11 min-w-0 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-3 text-base text-[var(--oc-ink)]" />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => shift(-7)} aria-label="Siete días antes" className={`${ghostBtn} px-3`}><ArrowLeft className="size-4" aria-hidden="true" /></button>
        <p className="min-w-0 flex-1 text-center text-base font-bold text-[var(--oc-ink)]" aria-live="polite">
          {mode === 'week' ? formatWeekRange(startOfWeek(anchor)) : `Desde ${relativeDayLabel(anchor, today).toLowerCase()}`}
        </p>
        <button type="button" onClick={() => shift(7)} aria-label="Siete días después" className={`${ghostBtn} px-3`}><ArrowRight className="size-4" aria-hidden="true" /></button>
        <button type="button" onClick={goToday} className={ghostBtn}>Hoy</button>
      </div>

      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--oc-muted)]">
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="size-5" />
        Mostrar terminados y cancelados
      </label>

      {loadError && (
        <div role="alert" className="mt-4 rounded-xl bg-[var(--oc-danger-bg)] px-4 py-3 text-sm font-semibold text-[var(--oc-coral)]">
          <p className="break-words">{loadError}</p>
          <button type="button" onClick={() => setVersion((v) => v + 1)} className="mt-2 min-h-11 underline">Reintentar</button>
        </div>
      )}
      {!data && !loadError && <p className="mt-6 text-sm text-[var(--oc-muted)]">Cargando agenda…</p>}
      {data && loading && <p className="mt-4 text-xs text-[var(--oc-muted)]" role="status">Actualizando…</p>}

      {/* Vista semanal */}
      {data && mode === 'week' && (
        <>
          <div role="group" aria-label="Días de la semana" className="mt-4 flex gap-2 overflow-x-auto pb-2 md:grid md:grid-cols-7 md:overflow-visible">
            {days.map((d) => {
              const n = counts[d] ?? 0
              const selected = d === selectedDay
              return (
                <button key={d} type="button" aria-pressed={selected} onClick={() => setSelectedDay(d)}
                  aria-label={`${formatDayLong(d, today)}: ${n === 0 ? 'sin trabajos' : n === 1 ? '1 trabajo' : `${n} trabajos`}`}
                  className={`flex min-h-[4.5rem] min-w-[4.25rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border px-2 py-2 md:min-w-0 ${selected ? 'border-[var(--oc-brand)] bg-[var(--oc-brand)] text-white' : d === today ? 'border-[var(--oc-coral)] bg-[var(--oc-surface)] text-[var(--oc-ink)]' : 'border-[var(--oc-border)] bg-[var(--oc-surface)] text-[var(--oc-ink)]'}`}>
                  <span className="text-xs font-semibold capitalize">{weekdayShort(d)}</span>
                  <span className="text-lg font-bold">{dayNumber(d)}</span>
                  <span className="text-center text-xs font-semibold">{n === 0 ? '—' : n === 1 ? '1 trabajo' : `${n} trabajos`}</span>
                </button>
              )
            })}
          </div>
          <h2 className="mt-4 text-lg font-bold text-[var(--oc-ink)]">{relativeDayLabel(selectedDay, today)}</h2>
          <div className="mt-3 flex flex-col gap-3">
            {dayJobs.length === 0 ? (
              <div className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
                <p className="text-sm font-semibold text-[var(--oc-ink)]">No hay trabajos para este día.</p>
                <button type="button" onClick={() => openNew(selectedDay)} className={`${ghostBtn} mt-3`}>Agendar un trabajo para este día</button>
              </div>
            ) : dayJobs.map((j) => card(j))}
          </div>
        </>
      )}

      {/* Vista agenda */}
      {data && mode === 'agenda' && (
        <>
          {overdue.length > 0 && (
            <section className="mt-6" aria-labelledby="ag-overdue">
              <h2 id="ag-overdue" className="text-lg font-bold text-[var(--oc-coral)]">Atrasados</h2>
              <p className="mt-1 text-sm text-[var(--oc-muted)]">Pasó la fecha y siguen abiertos. Marcalos como terminados, reprogramalos o cancelalos.</p>
              <div className="mt-3 flex flex-col gap-3">{overdue.map((j) => card(j, true))}</div>
            </section>
          )}
          {groups.map((g) => (
            <section key={g.date} className="mt-6" aria-labelledby={`ag-${g.date}`}>
              <h2 id={`ag-${g.date}`} className="text-lg font-bold text-[var(--oc-ink)]">{relativeDayLabel(g.date, today)}</h2>
              <div className="mt-3 flex flex-col gap-3">{g.jobs.map((j) => card(j))}</div>
            </section>
          ))}
          {nothingAtAll && (
            <div className="mt-6 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-6 text-center">
              <p className="font-bold text-[var(--oc-ink)]">No tenés trabajos agendados desde esta fecha.</p>
              <p className="mt-1 text-sm text-[var(--oc-muted)]">Agendá el primero, o desde la ficha de un cliente o un presupuesto aceptado.</p>
              <button type="button" onClick={() => openNew()} className={`${primaryBtn} mt-4`}>+ Nuevo trabajo</button>
            </div>
          )}
        </>
      )}

      {/* Sin fecha: en ambas vistas */}
      {data && unscheduled.length > 0 && (
        <section className="mt-8" aria-labelledby="ag-unscheduled">
          <h2 id="ag-unscheduled" className="text-lg font-bold text-[var(--oc-ink)]">Pendientes de coordinar</h2>
          <p className="mt-1 text-sm text-[var(--oc-muted)]">Todavía no tienen fecha. Cuando la acordés, tocá “Editar” o “Reprogramar”.</p>
          <div className="mt-3 flex flex-col gap-3">{unscheduled.map((j) => card(j))}</div>
        </section>
      )}
    </div>
  )
}

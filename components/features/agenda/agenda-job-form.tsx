'use client'

import { useRef, useState, useTransition } from 'react'
import { ArrowLeft, MapPin } from 'lucide-react'
import { createAgendaJob, updateAgendaJob } from '@/lib/actions/agenda'
import { fetchLinkableQuotes, linkQuoteToJob, type LinkableQuote } from '@/lib/actions/quoteBuilder'
import { QUOTE_STATUS_LABEL, quoteNumberLabel } from '@/lib/quotes'
import {
  DURATION_PRESETS, JOB_STATUSES, MAX_ADDRESS, MAX_DESCRIPTION, MAX_NOTES, STATUS_LABEL, STATUSES_NEED_DATE,
  formatDuration, trimTime, validateJobInput, type AgendaJob, type JobInput, type JobStatus,
} from '@/lib/agenda'

export type AgendaCustomer = { id: string; name: string; phone: string | null; address: string | null }

export type JobFormInitial = Partial<JobInput> & { id?: string }

const field =
  'min-h-11 w-full rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-3 py-2.5 text-base text-[var(--oc-ink)] outline-none focus:border-[var(--oc-brand)] focus:ring-4 focus:ring-[var(--oc-brand-soft)] disabled:opacity-70'
const label = 'flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-[var(--oc-muted)]'

export function AgendaJobForm({
  initial, customers, quoteLabel, defaultDate, onSaved, onCancel, onQuote,
}: {
  initial: JobFormInitial
  customers: AgendaCustomer[]
  /** Si el trabajo viene de un presupuesto (nuevo o existente): "Presupuesto Nº 00012". */
  quoteLabel?: string | null
  defaultDate: string | null
  onSaved: (job: AgendaJob, info: { duplicate: boolean; created: boolean; quote?: boolean }) => void
  onCancel: () => void
  /** Abre el formulario de presupuesto para este trabajo (o el ya vinculado). */
  onQuote?: (c: { jobId: string; customerId: string | null; quoteId?: string | null }) => void
}) {
  const editing = !!initial.id
  const lockedToQuote = !!initial.quote_id // cliente y presupuesto no se cambian
  const startDate = initial.job_date !== undefined ? initial.job_date : defaultDate

  const [customerId, setCustomerId] = useState<string>(initial.customer_id ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [date, setDate] = useState(startDate ?? '')
  const [time, setTime] = useState(trimTime(initial.start_time) ?? '')
  const [duration, setDuration] = useState(initial.duration_minutes ? String(initial.duration_minutes) : '')
  const [address, setAddress] = useState(initial.address ?? '')
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [status, setStatus] = useState<JobStatus>(initial.status ?? (startDate ? 'scheduled' : 'pending'))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const submitting = useRef(false) // evita un segundo envío antes de que React refleje `pending`

  const customer = customers.find((c) => c.id === customerId) ?? null
  const durationOptions = [...DURATION_PRESETS]
  if (initial.duration_minutes && !durationOptions.some((d) => d.minutes === initial.duration_minutes)) {
    durationOptions.push({ minutes: initial.duration_minutes, label: formatDuration(initial.duration_minutes) })
    durationOptions.sort((a, b) => a.minutes - b.minutes)
  }

  function buildInput(): JobInput {
    return {
      customer_id: customerId || null,
      quote_id: initial.quote_id ?? null,
      description,
      job_date: date || null,
      start_time: time || null,
      duration_minutes: duration ? Number(duration) : null,
      address: address || null,
      notes: notes || null,
      status,
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    save(false)
  }

  /** Guarda el trabajo. Con `thenQuote`, al terminar abre el presupuesto de este trabajo (sin volver a elegir cliente). */
  function save(thenQuote: boolean) {
    if (submitting.current) return
    const input = buildInput()
    const invalid = validateJobInput({ ...input, description: input.description.trim() })
    if (invalid) { setError(invalid); return }
    setError(null)
    submitting.current = true
    startTransition(async () => {
      try {
        const res = editing ? await updateAgendaJob(initial.id!, input) : await createAgendaJob(input)
        if (res.error || !res.data) { setError(res.error ?? 'No se pudo guardar el trabajo.'); return }
        onSaved(res.data, { duplicate: 'duplicate' in res && !!res.duplicate, created: !editing, quote: thenQuote })
      } catch {
        setError('No se pudo guardar. Revisá tu conexión e intentá de nuevo. El trabajo no se guardó.')
      } finally {
        submitting.current = false
      }
    })
  }

  // ---- vincular un presupuesto que ya existe (se guardan antes los cambios del formulario)
  const [linking, setLinking] = useState<{ items: LinkableQuote[] | null; error: string | null } | null>(null)
  async function openLinker() {
    setLinking({ items: null, error: null })
    const r = await fetchLinkableQuotes(customerId || null).catch(() => ({ error: 'No se pudieron cargar tus presupuestos. Revisá tu conexión.' }))
    setLinking('error' in r ? { items: null, error: r.error } : { items: r.data, error: null })
  }
  function linkExisting(quoteId: string) {
    if (submitting.current || !initial.id) return
    const input = buildInput()
    const invalid = validateJobInput({ ...input, description: input.description.trim() })
    if (invalid) { setError(invalid); return }
    setError(null)
    submitting.current = true
    startTransition(async () => {
      try {
        const saved = await updateAgendaJob(initial.id!, input)
        if (saved.error || !saved.data) { setError(saved.error ?? 'No se pudo guardar el trabajo.'); return }
        const linked = await linkQuoteToJob(initial.id!, quoteId)
        if ('error' in linked) { setError(linked.error); return }
        onSaved({ ...saved.data, quote_id: quoteId }, { duplicate: false, created: false })
      } catch {
        setError('No se pudo vincular. Revisá tu conexión e intentá de nuevo.')
      } finally {
        submitting.current = false
      }
    })
  }

  const needsDate = STATUSES_NEED_DATE.includes(status) && !date

  return (
    <form onSubmit={submit} aria-busy={pending} className="mx-auto max-w-[720px] p-5 pb-28 md:p-8">
      <button type="button" onClick={onCancel} className="mb-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--oc-brand)]">
        <ArrowLeft className="size-4" aria-hidden="true" />Volver a la agenda
      </button>
      <h1 className="text-2xl font-bold text-[var(--oc-ink)]">{editing ? 'Editar trabajo' : 'Nuevo trabajo'}</h1>
      {quoteLabel && <p className="mt-1 text-sm text-[var(--oc-muted)]">Vinculado al {quoteLabel}.</p>}

      <div className="mt-5 grid gap-4 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4 sm:p-5">
        <label className={label}>
          Cliente (opcional)
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={lockedToQuote} className={field}>
            <option value="">Sin cliente</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {lockedToQuote && <span className="text-xs font-normal">El cliente es el del presupuesto y no se puede cambiar acá.</span>}
        </label>

        <label className={label}>
          ¿Qué trabajo es?
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={MAX_DESCRIPTION} required placeholder="Ej.: Cambio de canilla de cocina" className={field} />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Fecha
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </label>
          <label className={label}>
            Horario (opcional)
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} className={field} />
            {!date && <span className="text-xs font-normal">Elegí primero una fecha.</span>}
          </label>
        </div>

        <label className={label}>
          Duración estimada (opcional)
          <select value={duration} onChange={(e) => setDuration(e.target.value)} className={field}>
            <option value="">Sin definir</option>
            {durationOptions.map((d) => <option key={d.minutes} value={d.minutes}>{d.label}</option>)}
          </select>
        </label>

        <label className={label}>
          Dirección o lugar (opcional)
          <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={MAX_ADDRESS} placeholder="Calle y número, barrio…" className={field} />
          {customer?.address && customer.address !== address && (
            <button type="button" onClick={() => setAddress(customer.address ?? '')} className="flex min-h-11 items-start gap-2 rounded-xl border border-[var(--oc-border)] px-3 py-2 text-left text-sm font-semibold text-[var(--oc-brand)]">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">Usar la dirección del cliente: {customer.address}</span>
            </button>
          )}
        </label>

        <label className={label}>
          Estado
          <select value={status} onChange={(e) => setStatus(e.target.value as JobStatus)} className={field}>
            {JOB_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {needsDate && <span role="status" className="text-xs font-normal text-[var(--oc-coral)]">Para este estado hace falta una fecha. Si todavía no la coordinaste, elegí “{STATUS_LABEL.pending}”.</span>}
        </label>

        {onQuote && (
          <section aria-labelledby="job-quote" className="grid gap-3 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-page)] p-3">
            <h2 id="job-quote" className="text-sm font-bold text-[var(--oc-ink)]">Presupuesto</h2>
            {initial.quote_id ? (
              <>
                <p className="text-sm text-[var(--oc-muted)]">Este trabajo está vinculado a un presupuesto.</p>
                {editing && <button type="button" onClick={() => onQuote({ jobId: initial.id!, customerId: customerId || null, quoteId: initial.quote_id })} className="min-h-11 self-start rounded-xl border border-[var(--oc-border)] px-4 text-sm font-bold text-[var(--oc-brand)]">Ver presupuesto</button>}
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--oc-muted)]">{customer ? `Se presupuesta para ${customer.name}: no hace falta elegir el cliente de nuevo.` : 'Si todavía no elegiste cliente, podés buscarlo o crearlo dentro del presupuesto.'}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" disabled={pending} onClick={() => save(true)} className="min-h-11 rounded-xl bg-[var(--oc-coral)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{editing ? 'Guardar y armar presupuesto' : 'Guardar trabajo y armar presupuesto'}</button>
                  {editing && <button type="button" disabled={pending} onClick={() => (linking ? setLinking(null) : openLinker())} className="min-h-11 rounded-xl border border-[var(--oc-border)] px-4 py-2.5 text-sm font-bold text-[var(--oc-brand)] disabled:opacity-60">{linking ? 'Cerrar' : 'Vincular uno existente'}</button>}
                </div>
                {linking && (
                  <div className="rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)]">
                    {linking.error && <p role="alert" className="p-3 text-sm font-semibold text-[var(--oc-coral)]">{linking.error}</p>}
                    {!linking.items && !linking.error && <p role="status" className="p-3 text-sm text-[var(--oc-muted)]">Cargando presupuestos…</p>}
                    {linking.items && linking.items.length === 0 && <p className="p-3 text-sm text-[var(--oc-muted)]">No hay presupuestos disponibles{customerId ? ' para este cliente' : ''}. Los que ya tienen un trabajo en la agenda no se listan.</p>}
                    {linking.items && linking.items.length > 0 && (
                      <ul className="max-h-60 divide-y divide-[var(--oc-border-soft)] overflow-y-auto">
                        {linking.items.map((q) => (
                          <li key={q.id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <div className="min-w-0"><p className="text-sm font-bold text-[var(--oc-ink)]">Presupuesto {quoteNumberLabel(q.number)}</p><p className="truncate text-xs text-[var(--oc-muted)]">{q.customerName ?? 'Sin cliente'} · {QUOTE_STATUS_LABEL[q.status] ?? q.status} · ${Number(q.total).toLocaleString('es-AR')}</p></div>
                            <button type="button" disabled={pending} onClick={() => linkExisting(q.id)} className="min-h-11 shrink-0 rounded-xl bg-[var(--oc-brand)] px-3 text-sm font-bold text-white disabled:opacity-60">Vincular</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        <label className={label}>
          Observaciones (opcional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={MAX_NOTES} rows={4} placeholder="Acceso, materiales, detalles que no querés olvidar…" className={`${field} resize-y`} />
        </label>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-[var(--oc-danger-bg)] px-4 py-3 text-sm font-semibold text-[var(--oc-coral)]">{error}</p>}

      {/* Barra fija: el botón Guardar queda siempre visible, por encima de la barra inferior del celular */}
      <div className="sticky bottom-[4.5rem] z-20 -mx-5 mt-5 flex flex-col-reverse gap-3 border-t border-[var(--oc-border)] bg-[var(--oc-page)] px-5 py-3 sm:flex-row sm:justify-end md:bottom-0 md:mx-0 md:px-0">
        <button type="button" onClick={onCancel} disabled={pending} className="min-h-11 rounded-xl border border-[var(--oc-border)] px-5 py-2.5 text-sm font-bold text-[var(--oc-muted)] disabled:opacity-60">Cancelar</button>
        <button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-[var(--oc-brand)] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
          {pending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar trabajo'}
        </button>
      </div>
    </form>
  )
}

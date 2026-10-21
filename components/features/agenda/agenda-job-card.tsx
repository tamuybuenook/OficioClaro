'use client'

import { useState, useTransition } from 'react'
import { MapPin, Users } from 'lucide-react'
import { setAgendaJobStatus, updateAgendaJob } from '@/lib/actions/agenda'
import {
  DURATION_PRESETS, JOB_STATUSES, STATUS_LABEL, formatDuration, formatTimeRange, trimTime,
  type AgendaJob, type JobInput, type JobStatus,
} from '@/lib/agenda'
import { StatusBadge } from './status-badge'

const field =
  'min-h-11 w-full rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-3 py-2 text-base text-[var(--oc-ink)] outline-none focus:border-[var(--oc-brand)]'
// Base sin colores + variantes completas: evita que dos clases de fondo compitan entre sí.
const btnBase = 'min-h-11 rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-60'
const btnPrimary = `${btnBase} border-[var(--oc-brand)] bg-[var(--oc-brand)] text-white`
const btnDanger = `${btnBase} border-[var(--oc-coral)] bg-[var(--oc-coral)] text-white`
const btnGhost = `${btnBase} border-[var(--oc-border)] bg-[var(--oc-surface)] text-[var(--oc-brand)]`
const btnGhostDanger = `${btnBase} border-[var(--oc-border)] bg-[var(--oc-surface)] text-[var(--oc-coral)]`
const btnMuted = `${btnBase} border-[var(--oc-border)] bg-[var(--oc-surface)] text-[var(--oc-muted)]`

export function AgendaJobCard({
  job, highlighted, showDate, onEdit, onChanged, onOpenClient,
}: {
  job: AgendaJob
  highlighted?: boolean
  /** En listas que no agrupan por día (atrasados, sin fecha) conviene mostrar la fecha. */
  showDate?: boolean
  onEdit: (job: AgendaJob) => void
  onChanged: (job: AgendaJob, message: string) => void
  onOpenClient: (customerId: string) => void
}) {
  const [panel, setPanel] = useState<'none' | 'reschedule' | 'cancel'>('none')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const [rDate, setRDate] = useState(job.job_date ?? '')
  const [rTime, setRTime] = useState(trimTime(job.start_time) ?? '')
  const [rDuration, setRDuration] = useState(job.duration_minutes ? String(job.duration_minutes) : '')
  const [reason, setReason] = useState('')

  const closed = job.status === 'done' || job.status === 'cancelled'
  const canReschedule = job.status === 'pending' || job.status === 'scheduled'
  const canCancel = !closed

  function changeStatus(next: JobStatus) {
    if (next === job.status) return
    setError(null)
    if (next === 'cancelled') { setPanel('cancel'); return }
    startTransition(async () => {
      try {
        const res = await setAgendaJobStatus(job.id, next)
        if (res.error || !res.data) { setError(res.error ?? 'No se pudo cambiar el estado.'); return }
        onChanged(res.data, `Estado actualizado: ${STATUS_LABEL[next]}.`)
      } catch { setError('No se pudo cambiar el estado. Revisá tu conexión e intentá de nuevo.') }
    })
  }

  function confirmCancel() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await setAgendaJobStatus(job.id, 'cancelled', reason)
        if (res.error || !res.data) { setError(res.error ?? 'No se pudo cancelar el trabajo.'); return }
        setPanel('none')
        onChanged(res.data, 'Trabajo cancelado. Queda en tu historial.')
      } catch { setError('No se pudo cancelar. Revisá tu conexión e intentá de nuevo.') }
    })
  }

  function confirmReschedule() {
    if (!rDate) { setError('Elegí la nueva fecha.'); return }
    setError(null)
    const input: JobInput = {
      customer_id: job.customer_id, quote_id: job.quote_id, description: job.description,
      job_date: rDate, start_time: rTime || null, duration_minutes: rDuration ? Number(rDuration) : null,
      address: job.address, notes: job.notes, status: job.status === 'pending' ? 'scheduled' : job.status,
    }
    startTransition(async () => {
      try {
        const res = await updateAgendaJob(job.id, input)
        if (res.error || !res.data) { setError(res.error ?? 'No se pudo reprogramar.'); return }
        setPanel('none')
        onChanged(res.data, 'Trabajo reprogramado.')
      } catch { setError('No se pudo reprogramar. Revisá tu conexión e intentá de nuevo.') }
    })
  }

  const when = job.job_date
    ? `${showDate ? `${job.job_date.split('-').reverse().join('/')} · ` : ''}${formatTimeRange(job.start_time, job.duration_minutes)}`
    : 'Sin fecha'

  return (
    <article id={`job-${job.id}`} aria-label={job.description}
      className={`min-w-0 rounded-2xl border bg-[var(--oc-surface)] p-4 ${highlighted ? 'border-[var(--oc-brand)] ring-4 ring-[var(--oc-brand-soft)]' : 'border-[var(--oc-border)]'} ${job.status === 'cancelled' ? 'opacity-80' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-bold text-[var(--oc-brand)]">{when}</p>
        <StatusBadge status={job.status} />
      </div>

      <h3 className={`mt-2 break-words text-base font-bold text-[var(--oc-ink)] ${job.status === 'cancelled' ? 'line-through' : ''}`}>{job.description}</h3>

      <div className="mt-2 flex flex-col gap-1.5 text-sm text-[var(--oc-muted)]">
        {job.customers && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Users className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words font-semibold text-[var(--oc-ink)]">{job.customers.name}</span>
            <button type="button" onClick={() => onOpenClient(job.customers!.id)} className="min-h-11 px-1 text-sm font-bold text-[var(--oc-brand)] underline">Ver ficha</button>
          </div>
        )}
        {job.address && <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{job.address}</span></p>}
        {job.duration_minutes && <p>Duración estimada: {formatDuration(job.duration_minutes)}</p>}
        {job.notes && <p className="whitespace-pre-wrap break-words rounded-xl bg-[var(--oc-surface-muted)] px-3 py-2 text-[var(--oc-ink)]">{job.notes}</p>}
        {job.rescheduled_count > 0 && <p className="text-xs font-semibold">Reprogramado {job.rescheduled_count} {job.rescheduled_count === 1 ? 'vez' : 'veces'}</p>}
        {job.status === 'cancelled' && job.cancel_reason && <p className="break-words text-xs font-semibold">Motivo de la cancelación: {job.cancel_reason}</p>}
        {job.quote_id && <p className="text-xs font-semibold">Viene de un presupuesto aceptado.</p>}
      </div>

      {panel === 'reschedule' && (
        <div className="mt-3 grid gap-3 rounded-xl border border-[var(--oc-border)] p-3">
          <p className="text-sm font-bold text-[var(--oc-ink)]">Reprogramar</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold text-[var(--oc-muted)]">Nueva fecha<input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} className={field} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-[var(--oc-muted)]">Horario<input type="time" value={rTime} onChange={(e) => setRTime(e.target.value)} className={field} /></label>
          </div>
          <label className="flex flex-col gap-1 text-sm font-semibold text-[var(--oc-muted)]">Duración estimada
            <select value={rDuration} onChange={(e) => setRDuration(e.target.value)} className={field}>
              <option value="">Sin definir</option>
              {DURATION_PRESETS.map((d) => <option key={d.minutes} value={d.minutes}>{d.label}</option>)}
              {job.duration_minutes && !DURATION_PRESETS.some((d) => d.minutes === job.duration_minutes) && <option value={job.duration_minutes}>{formatDuration(job.duration_minutes)}</option>}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmReschedule} disabled={pending} className={btnPrimary}>{pending ? 'Guardando…' : 'Guardar nueva fecha'}</button>
            <button type="button" onClick={() => { setPanel('none'); setError(null) }} disabled={pending} className={btnMuted}>Volver</button>
          </div>
        </div>
      )}

      {panel === 'cancel' && (
        <div className="mt-3 grid gap-3 rounded-xl border border-[var(--oc-border)] p-3">
          <p className="text-sm font-bold text-[var(--oc-ink)]">¿Cancelar este trabajo?</p>
          <p className="text-sm text-[var(--oc-muted)]">No se borra: queda como “Cancelado” con su historial, y podés reactivarlo cambiando el estado.</p>
          <label className="flex flex-col gap-1 text-sm font-semibold text-[var(--oc-muted)]">Motivo (opcional)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={field} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmCancel} disabled={pending} className={btnDanger}>{pending ? 'Cancelando…' : 'Sí, cancelar trabajo'}</button>
            <button type="button" onClick={() => { setPanel('none'); setError(null) }} disabled={pending} className={btnMuted}>No, volver</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-xl bg-[var(--oc-danger-bg)] px-3 py-2 text-sm font-semibold text-[var(--oc-coral)]">{error}</p>}

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--oc-border-soft)] pt-3">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-semibold text-[var(--oc-muted)]">Cambiar estado
          <select value={job.status} onChange={(e) => changeStatus(e.target.value as JobStatus)} disabled={pending} className={field}>
            {JOB_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => onEdit(job)} disabled={pending} className={btnGhost}>Editar</button>
        {canReschedule && panel !== 'reschedule' && <button type="button" onClick={() => { setPanel('reschedule'); setError(null) }} disabled={pending} className={btnGhost}>Reprogramar</button>}
        {canCancel && panel !== 'cancel' && <button type="button" onClick={() => { setPanel('cancel'); setError(null) }} disabled={pending} className={btnGhostDanger}>Cancelar</button>}
      </div>
    </article>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { fetchAgenda } from '@/lib/actions/agenda'
import { ACTIVE_STATUSES, addDays, compareJobs, formatTimeRange, relativeDayLabel, todayISO, type AgendaJob } from '@/lib/agenda'
import { StatusBadge } from './status-badge'

// Resumen para Inicio: los próximos trabajos de los siguientes 14 días.
export function UpcomingJobs({ onOpenAgenda, onNew }: { onOpenAgenda: () => void; onNew: () => void }) {
  const [today] = useState(() => todayISO())
  const [jobs, setJobs] = useState<AgendaJob[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    fetchAgenda(today, addDays(today, 14), today)
      .then((res) => {
        if (!alive) return
        if (res.error || !res.data) setError(true)
        else setJobs(res.data.jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).sort(compareJobs).slice(0, 3))
      })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [today])

  return (
    <div className="min-w-0 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5 md:col-span-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#8a979a]">Próximos trabajos</p>
      {error && <p className="mt-2 text-sm text-[var(--oc-muted)]">No pudimos cargar tu agenda en este momento.</p>}
      {!error && jobs === null && <p className="mt-2 text-sm text-[var(--oc-muted)]">Cargando…</p>}
      {jobs && jobs.length === 0 && (
        <div className="mt-2">
          <p className="text-sm text-[var(--oc-muted)]">No tenés trabajos agendados en los próximos días.</p>
          <button type="button" onClick={onNew} className="mt-2 min-h-11 text-sm font-bold text-[var(--oc-brand)] underline">Agendar un trabajo</button>
        </div>
      )}
      {jobs && jobs.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-[var(--oc-border-soft)]">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-bold text-[var(--oc-ink)]">{j.description}</p>
                <p className="text-xs text-[var(--oc-muted)]">{j.job_date ? relativeDayLabel(j.job_date, today) : ''} · {formatTimeRange(j.start_time, j.duration_minutes)}{j.customers ? ` · ${j.customers.name}` : ''}</p>
              </div>
              <StatusBadge status={j.status} />
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onOpenAgenda} className="mt-3 flex min-h-11 items-center gap-1 text-sm font-bold text-[var(--oc-brand)]">Ver agenda <ArrowRight className="size-4" aria-hidden="true" /></button>
    </div>
  )
}

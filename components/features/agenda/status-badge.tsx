import { Check, ClipboardList, CalendarDays, Wrench, X } from 'lucide-react'
import { STATUS_LABEL, type JobStatus } from '@/lib/agenda'

// Cada estado se distingue por color, ícono Y texto (no depende solo del color).
// Tamaños en rem para que acompañen el tamaño de letra configurado en el dispositivo.
const STYLE: Record<JobStatus, { cls: string; Icon: typeof Check }> = {
  pending: { cls: 'bg-[var(--oc-warning-bg)] text-[var(--oc-warning-text)]', Icon: ClipboardList },
  scheduled: { cls: 'bg-[var(--oc-blue-bg)] text-[var(--oc-blue-text)]', Icon: CalendarDays },
  in_progress: { cls: 'bg-[var(--oc-warm-bg)] text-[var(--oc-warm-text)]', Icon: Wrench },
  done: { cls: 'bg-[var(--oc-success-bg)] text-[var(--oc-success-text)]', Icon: Check },
  cancelled: { cls: 'bg-[var(--oc-neutral-bg)] text-[var(--oc-neutral-text)]', Icon: X },
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const { cls, Icon } = STYLE[status]
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="break-words">{STATUS_LABEL[status]}</span>
    </span>
  )
}

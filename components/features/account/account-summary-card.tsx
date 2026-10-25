'use client'

import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { AccountNotice, AccountSummary } from '@/lib/account-summary'

// Tarjeta "Estado de cuenta" del inicio y avisos internos. Muestra lo que el servidor ya validó (suscripción, pagos y días
// restantes); no decide acceso. La acción solo lleva a la pantalla Mi suscripción.

export function AccountSummaryCard({ summary, onAction }: { summary: AccountSummary; onAction: () => void }) {
  return (
    <section aria-labelledby="acct-title" className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="acct-title" className="text-xs font-semibold uppercase tracking-wide text-[var(--oc-muted)]">Estado de cuenta</p>
          <p className="mt-1 break-words text-xl font-bold text-[var(--oc-ink)]">{summary.planName}</p>
        </div>
        <Badge tone={summary.tone}>{summary.stateLabel}</Badge>
      </div>
      <div className="mt-5 flex items-start justify-between gap-3 border-t border-[var(--oc-border-soft)] pt-4 text-sm">
        <span className="text-[var(--oc-muted)]">{summary.endCaption}</span>
        <span className="text-right">
          <span className="block font-semibold text-[var(--oc-ink)]" data-testid="end-date">{summary.endLabel}</span>
          {summary.days && <span className="block text-xs font-semibold text-[var(--oc-muted)]" data-testid="days-left">{summary.days}</span>}
        </span>
      </div>
      <button type="button" onClick={onAction} className="mt-4 flex min-h-11 items-center gap-1 text-sm font-bold text-[var(--oc-brand)]">{summary.action.label} <ArrowRight className="size-4" aria-hidden="true" /></button>
    </section>
  )
}

const TONE: Record<AccountNotice['tone'], string> = {
  info: 'bg-[var(--oc-blue-bg)] text-[var(--oc-blue-text)]',
  warning: 'bg-[var(--oc-warning-bg)] text-[var(--oc-warning-text)]',
}

export function AccountNotices({ notices, onOpen }: { notices: AccountNotice[]; onOpen: () => void }) {
  if (notices.length === 0) return null
  return (
    <ul className="mb-5 grid gap-2" aria-label="Avisos de tu cuenta">
      {notices.map((n) => (
        <li key={n.id} role={n.tone === 'warning' ? 'alert' : 'status'} className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold ${TONE[n.tone]}`}>
          <span className="min-w-0 flex-1">{n.text}</span>
          <button type="button" onClick={onOpen} className="min-h-11 shrink-0 rounded-xl bg-[var(--oc-surface)] px-3 text-xs font-bold text-[var(--oc-ink)] shadow-sm">Ver detalle</button>
        </li>
      ))}
    </ul>
  )
}

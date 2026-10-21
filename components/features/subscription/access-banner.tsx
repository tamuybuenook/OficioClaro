import type { Notice } from '@/lib/subscription-notice'

const TONE: Record<Notice['tone'], string> = {
  info: 'bg-[var(--oc-blue-bg)] text-[var(--oc-blue-text)]',
  warning: 'bg-[var(--oc-warning-bg)] text-[var(--oc-warning-text)]',
  danger: 'bg-[var(--oc-coral-soft)] text-[var(--oc-coral)]',
}

export function AccessBanner({ notice, actionLabel, onAction }: { notice: Notice; actionLabel?: string; onAction?: () => void }) {
  return (
    <div role={notice.tone === 'info' ? 'status' : 'alert'} className={`mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold md:mx-8 ${TONE[notice.tone]}`}>
      <p className="min-w-0 flex-1">{notice.text}</p>
      {actionLabel && onAction && <button onClick={onAction} className="shrink-0 rounded-xl bg-[var(--oc-surface)] px-3 py-2 text-xs font-bold text-[var(--oc-ink)] shadow-sm">{actionLabel}</button>}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'success' | 'warning' | 'neutral' | 'blue' }) {
  const styles = {
    success: 'bg-[var(--oc-success-bg)] text-[var(--oc-success-text)]',
    warning: 'bg-[var(--oc-warning-bg)] text-[var(--oc-warning-text)]',
    neutral: 'bg-[var(--oc-neutral-bg)] text-[var(--oc-neutral-text)]',
    blue: 'bg-[var(--oc-blue-bg)] text-[var(--oc-blue-text)]',
  }
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles[tone]}`}>{children}</span>
}

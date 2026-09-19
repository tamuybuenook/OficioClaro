import { requireAdmin } from '@/lib/auth/require-admin'
import { adminNavGroups } from '@/components/admin/admin-nav-config'
import { AdminMobileNav } from '@/components/admin/admin-mobile-nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--oc-page)] text-[var(--oc-ink)] md:flex-row">
      <AdminMobileNav />
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-[var(--oc-border)] bg-[var(--oc-surface-muted)] px-4 py-6 md:flex">
        <a href="/" className="mb-6 px-2 py-2 text-sm font-semibold text-[var(--oc-muted)] hover:underline">← Salir de Admin</a>
        <nav className="flex flex-col gap-4">
          {adminNavGroups.map((g) => (
            <div key={g.label ?? 'root'}>
              {g.label && <p className="px-2 text-[11px] font-bold uppercase tracking-wide text-[var(--oc-muted)]">{g.label}</p>}
              <div className="mt-1 flex flex-col gap-0.5">
                {g.links.map((l) => (
                  <a key={l.href} href={l.href} className="rounded-lg px-2 py-2 text-sm font-semibold text-[var(--oc-ink)] hover:bg-[var(--oc-surface-soft)]">{l.label}</a>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 p-5 pb-10 md:p-8">{children}</div>
    </div>
  )
}

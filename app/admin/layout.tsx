import { requireAdmin } from '@/lib/auth/require-admin'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { AdminMobileNav } from '@/components/admin/admin-mobile-nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--oc-page)] text-[var(--oc-ink)] md:flex-row">
      <AdminMobileNav />
      <AdminSidebar />
      <div className="min-w-0 flex-1 p-5 pb-10 md:p-8">{children}</div>
    </div>
  )
}

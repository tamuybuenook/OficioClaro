'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X, ShieldCheck } from 'lucide-react'
import { adminNavItems } from './admin-nav-config'

export function AdminMobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const current = adminNavItems.find((l) => l.href === pathname)?.label ?? 'Admin'

  return (
    <div className="md:hidden">
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--oc-border)] bg-[var(--oc-surface)] px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
        <button onClick={() => setOpen(true)} aria-label="Abrir menú de admin" className="flex items-center gap-2 rounded-lg p-1.5 text-[var(--oc-ink)]">
          <Menu className="size-5" />
          <span className="text-sm font-bold">{current}</span>
        </button>
        <a href="/" className="text-xs font-semibold text-[var(--oc-muted)]">Salir</a>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)}>
          <nav
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-[280px] max-w-[85vw] flex-col overflow-y-auto bg-[var(--oc-surface-muted)] p-5 pt-[calc(env(safe-area-inset-top,0px)+1.25rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold text-[var(--oc-brand)]">Admin</p>
              <button onClick={() => setOpen(false)} aria-label="Cerrar menú"><X className="size-5 text-[var(--oc-muted)]" /></button>
            </div>
            <a href="/" className="mb-4 flex items-center justify-center gap-2 rounded-xl border border-[var(--oc-border)] px-3 py-2.5 text-sm font-semibold text-[var(--oc-ink)]"><ShieldCheck className="size-[18px]" />Volver a la app</a>
            <div className="flex flex-col gap-0.5">
              {adminNavItems.map(({ href, label, icon: Icon }) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${pathname === href ? 'bg-[var(--oc-brand-soft)] text-[var(--oc-brand)]' : 'text-[var(--oc-ink)] hover:bg-[var(--oc-surface-soft)]'}`}
                >
                  <Icon className="size-[18px]" />{label}
                </a>
              ))}
            </div>
          </nav>
        </div>
      )}
    </div>
  )
}

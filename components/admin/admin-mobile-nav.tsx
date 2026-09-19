'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { adminNavGroups } from './admin-nav-config'

function currentLabel(pathname: string) {
  for (const g of adminNavGroups) {
    for (const l of g.links) if (l.href === pathname) return l.label
  }
  return 'Admin'
}

export function AdminMobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <div className="md:hidden">
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--oc-border)] bg-[var(--oc-surface)] px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
        <button onClick={() => setOpen(true)} aria-label="Abrir menú de admin" className="flex items-center gap-2 rounded-lg p-1.5 text-[var(--oc-ink)]">
          <Menu className="size-5" />
          <span className="text-sm font-bold">{currentLabel(pathname)}</span>
        </button>
        <a href="/" className="text-xs font-semibold text-[var(--oc-muted)]">Salir</a>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)}>
          <nav
            onClick={(e) => e.stopPropagation()}
            className="h-full w-[280px] max-w-[85vw] overflow-y-auto bg-[var(--oc-surface-muted)] p-5 pt-[calc(env(safe-area-inset-top,0px)+1.25rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] shadow-xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <p className="text-sm font-bold text-[var(--oc-brand)]">Admin</p>
              <button onClick={() => setOpen(false)} aria-label="Cerrar menú"><X className="size-5 text-[var(--oc-muted)]" /></button>
            </div>
            <a href="/" className="mb-4 block rounded-lg px-3 py-2.5 text-sm font-semibold text-[var(--oc-muted)]">← Salir de Admin</a>
            <div className="flex flex-col gap-4">
              {adminNavGroups.map((g) => (
                <div key={g.label ?? 'root'}>
                  {g.label && <p className="px-2 text-[11px] font-bold uppercase tracking-wide text-[var(--oc-muted)]">{g.label}</p>}
                  <div className="mt-1 flex flex-col gap-0.5">
                    {g.links.map((l) => (
                      <a
                        key={l.href}
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${pathname === l.href ? 'bg-[var(--oc-brand-soft)] text-[var(--oc-brand)]' : 'text-[var(--oc-ink)] hover:bg-[var(--oc-surface-soft)]'}`}
                      >
                        {l.label}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>
        </div>
      )}
    </div>
  )
}

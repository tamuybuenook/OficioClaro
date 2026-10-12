'use client'

import { usePathname } from 'next/navigation'
import { Wrench, Settings, ShieldCheck } from 'lucide-react'
import { adminNavItems } from './admin-nav-config'

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col border-r border-[var(--oc-border)] bg-[var(--oc-surface-muted)] px-4 py-6 md:flex">
      <div className="flex items-center gap-2 px-2">
        <div className="flex size-8 items-center justify-center rounded-full bg-[var(--oc-brand)] text-white"><Wrench className="size-4" /></div>
        <p className="text-base font-bold"><span className="text-[var(--oc-ink)]">Oficio</span><span className="text-[var(--oc-coral)]">Claro</span></p>
      </div>

      <a href="/" className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-[var(--oc-border)] px-3 py-2.5 text-sm font-semibold text-[var(--oc-ink)] hover:bg-[var(--oc-surface-soft)]"><ShieldCheck className="size-[18px]" />Volver a la app</a>

      <nav className="mt-6 flex flex-col gap-1">
        {adminNavItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <a key={href} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? 'bg-[var(--oc-brand-soft)] text-[var(--oc-brand)]' : 'text-[var(--oc-ink)] hover:bg-[var(--oc-surface-soft)]'}`}>
              <Icon className="size-[18px]" />{label}
            </a>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-[var(--oc-border-soft)] pt-4">
        <a href="/" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]"><Settings className="size-[18px]" />Mi perfil</a>
      </div>
    </aside>
  )
}

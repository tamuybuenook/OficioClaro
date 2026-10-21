'use client'

import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { ThemePicker } from '@/components/theme-picker'

const links = [
  { href: '#funcionalidades', label: 'Funcionalidades' },
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#planes', label: 'Planes' },
  { href: '#experiencias', label: 'Experiencias' },
]

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--lp-line)] bg-[var(--lp-ivory)]/95 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5">
        <a href="/" aria-label="OficioClaro, inicio"><Logo /></a>
        <nav aria-label="Principal" className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-[15px] font-semibold text-[var(--lp-ink-soft)] hover:text-[var(--lp-brand)]">{l.label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <ThemePicker large />
          <a href="/login" className="px-3 py-2 text-[15px] font-bold text-[var(--lp-brand)] hover:underline">Ingresar</a>
          <a href="/register" className="lp-btn lp-btn-brand !min-h-11 !px-5 !text-[15px]">Empezar gratis</a>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="menu-movil" aria-label={open ? 'Cerrar menú' : 'Abrir menú'} className="flex size-12 items-center justify-center rounded-xl border-2 border-[var(--lp-line)] md:hidden">
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>
      {open && (
        <div id="menu-movil" className="border-t border-[var(--lp-line)] bg-[var(--lp-ivory)] px-5 pb-5 md:hidden">
          <nav aria-label="Menú móvil" className="flex flex-col">
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="border-b border-[var(--lp-line)] py-4 text-lg font-semibold">{l.label}</a>
            ))}
          </nav>
          <div className="mt-4 grid gap-3">
            <a href="/register" className="lp-btn lp-btn-primary">Empezar gratis</a>
            <a href="/login" className="lp-btn lp-btn-ghost">Ya tengo cuenta</a>
            <div className="flex items-center justify-between gap-3 pt-2"><span className="text-sm font-semibold text-[var(--lp-ink-soft)]">Tema</span><ThemePicker large /></div>
          </div>
        </div>
      )}
    </header>
  )
}

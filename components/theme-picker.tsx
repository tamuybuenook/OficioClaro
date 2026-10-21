'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'
const KEY = 'oficioclaro-theme'

function apply(next: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', next === 'dark' || (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches))
  root.classList.toggle('light', next === 'light')
}

function readSaved(): Theme {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

// Selector de tema Claro / Oscuro / Sistema. Misma clave de almacenamiento y mismas clases (.dark / .light)
// que usaba la app; el script de app/layout.tsx aplica el tema antes de pintar para evitar destellos.
export function ThemePicker({ large = false }: { large?: boolean }) {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    const saved = readSaved()
    setTheme(saved)
    apply(saved)
    // En modo "Sistema", seguir los cambios del sistema operativo.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => { if (readSaved() === 'system') apply('system') }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const updateTheme = (next: Theme) => {
    setTheme(next)
    try { window.localStorage.setItem(KEY, next) } catch { /* sin almacenamiento: el cambio vale solo para esta visita */ }
    apply(next)
  }

  return (
    <div role="group" aria-label="Tema de color" className="flex items-center gap-1 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface-muted)] p-1">
      {([['light', 'Claro'], ['dark', 'Oscuro'], ['system', 'Sistema']] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => updateTheme(value)}
          aria-pressed={theme === value}
          className={`rounded-lg font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--oc-brand)] ${large ? 'min-h-10 px-3 text-sm' : 'px-1.5 py-1.5 text-[10px] sm:px-2 sm:text-[11px]'} ${value === 'system' ? 'hidden sm:block' : ''} ${theme === value ? 'bg-[var(--oc-surface)] text-[var(--oc-brand)] shadow-sm' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface)]'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

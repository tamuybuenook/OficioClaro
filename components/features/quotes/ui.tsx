'use client'

import { useEffect, useState } from 'react'
// Estilos y formateo compartidos por las pantallas de presupuestos y catálogo (mismo lenguaje visual que la agenda).
export const field =
  'min-h-11 w-full rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-3 py-2.5 text-base text-[var(--oc-ink)] outline-none focus:border-[var(--oc-brand)] focus:ring-4 focus:ring-[var(--oc-brand-soft)] disabled:opacity-70 aria-[invalid=true]:border-[var(--oc-coral)]'
export const fieldLabel = 'flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-[var(--oc-muted)]'
export const card = 'rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4 sm:p-5'
export const primaryBtn = 'min-h-11 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60'
export const coralBtn = 'min-h-11 rounded-xl bg-[var(--oc-coral)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60'
export const ghostBtn = 'min-h-11 rounded-xl border border-[var(--oc-border)] px-4 py-2.5 text-sm font-bold text-[var(--oc-muted)] disabled:opacity-60'
export const linkBtn = 'min-h-11 px-1 text-sm font-bold text-[var(--oc-brand)] underline disabled:opacity-60'
export const errText = 'text-xs font-semibold text-[var(--oc-coral)]'

export const money = (v: number) => `$${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

export function timeAgo(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ms) / 60000))
  if (m < 1) return 'hace un momento'
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // respaldo para navegadores sin randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** Valor que se retrasa `ms` (para no consultar el servidor en cada tecla). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

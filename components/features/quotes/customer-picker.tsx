'use client'

import { useState } from 'react'
import { Search, UserPlus, X } from 'lucide-react'
import { searchCustomers } from '@/lib/actions/quoteBuilder'
import { createCustomer } from '@/lib/actions/customers'
import { useCachedQuery } from '@/lib/cache/use-cached-query'
import { invalidate } from '@/lib/cache/store'
import type { CustomerOption } from '@/lib/quotes'
import { errText, field, fieldLabel, ghostBtn, primaryBtn, useDebounced } from './ui'

// Selector de cliente DENTRO del formulario: búsqueda visible, resultados, estado vacío y alta rápida.
// Sin ventanas modales ni prompts. Los resultados se guardan en el dispositivo (caché por usuario).

export function CustomerPicker({ value, onChange, disabled, lockedReason }: {
  value: CustomerOption | null; onChange: (c: CustomerOption | null) => void; disabled?: boolean; lockedReason?: string | null
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const dq = useDebounced(q.trim(), 250)
  const { data, loading, error, reload } = useCachedQuery<CustomerOption[]>(
    'customers', { q: dq.toLowerCase() },
    async () => { const r = await searchCustomers(dq); return 'error' in r ? { error: r.error } : r.data },
    { ttlMs: 2 * 60_000, enabled: open && !disabled },
  )

  if (value && !open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-page)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-[var(--oc-ink)]">{value.name}</p>
          <p className="truncate text-xs text-[var(--oc-muted)]">{[value.phone, value.address].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</p>
        </div>
        {!disabled && <button type="button" onClick={() => setOpen(true)} className="min-h-11 px-2 text-sm font-bold text-[var(--oc-brand)] underline">Cambiar</button>}
        {disabled && lockedReason && <p className="w-full text-xs text-[var(--oc-muted)]">{lockedReason}</p>}
      </div>
    )
  }

  if (creating) {
    return <NewCustomerInline initialName={q.trim()} onCancel={() => setCreating(false)} onCreated={(c) => { setCreating(false); setOpen(false); setQ(''); onChange(c) }} />
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="relative block">
        <span className="sr-only">Buscar cliente</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--oc-muted)]" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder="Buscar cliente por nombre o teléfono…" className={`${field} pl-9`} autoComplete="off" />
      </label>

      {open && (
        <div className="rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)]" role="listbox" aria-label="Clientes">
          {loading && !data && <p className="p-3 text-sm text-[var(--oc-muted)]">Buscando…</p>}
          {error && !data && (
            <div className="p-3 text-sm"><p className={errText}>{error}</p><button type="button" onClick={reload} className="mt-1 min-h-11 font-bold text-[var(--oc-brand)] underline">Reintentar</button></div>
          )}
          {data && data.length === 0 && !loading && (
            <p className="p-3 text-sm text-[var(--oc-muted)]">{dq ? `No encontramos clientes con “${dq}”.` : 'Todavía no cargaste clientes.'}</p>
          )}
          {data && data.length > 0 && (
            <ul className="max-h-64 divide-y divide-[var(--oc-border-soft)] overflow-y-auto">
              {data.map((c) => (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected={value?.id === c.id} onClick={() => { onChange(c); setOpen(false); setQ('') }} className="flex min-h-11 w-full flex-col px-3 py-2 text-left hover:bg-[var(--oc-surface-soft)]">
                    <span className="truncate text-sm font-bold text-[var(--oc-ink)]">{c.name}</span>
                    <span className="truncate text-xs text-[var(--oc-muted)]">{[c.phone, c.address].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--oc-border-soft)] p-2">
            <button type="button" onClick={() => setCreating(true)} className="flex min-h-11 items-center gap-2 px-2 text-sm font-bold text-[var(--oc-brand)]"><UserPlus className="size-4" aria-hidden="true" />Crear cliente nuevo</button>
            {(value || q) && <button type="button" onClick={() => { setOpen(false); setQ('') }} className="flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-[var(--oc-muted)]"><X className="size-4" aria-hidden="true" />Cerrar</button>}
          </div>
        </div>
      )}
    </div>
  )
}

function NewCustomerInline({ initialName, onCancel, onCreated }: { initialName: string; onCancel: () => void; onCreated: (c: CustomerOption) => void }) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy) return
    if (!name.trim()) { setError('Escribí el nombre del cliente.'); return }
    setBusy(true); setError(null)
    try {
      const fd = new FormData()
      fd.set('name', name.trim()); fd.set('phone', phone.trim()); fd.set('address', address.trim())
      const res = await createCustomer(fd)
      if (!res || 'error' in res && res.error || !res.data) { setError(('error' in (res ?? {}) && res?.error) || 'No se pudo crear el cliente.'); return }
      await invalidate('customers')
      onCreated({ id: res.data.id, name: res.data.name, phone: res.data.phone ?? null, address: res.data.address ?? null })
    } catch {
      setError('No se pudo crear el cliente. Revisá tu conexión e intentá de nuevo. Lo que cargaste en el presupuesto no se perdió.')
    } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-page)] p-3" role="group" aria-label="Nuevo cliente">
      <p className="text-sm font-bold text-[var(--oc-ink)]">Cliente nuevo</p>
      <label className={fieldLabel}>Nombre y apellido<input value={name} onChange={(e) => setName(e.target.value)} className={field} aria-invalid={!!error && !name.trim()} maxLength={120} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={fieldLabel}>Teléfono (opcional)<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={field} maxLength={40} /></label>
        <label className={fieldLabel}>Dirección (opcional)<input value={address} onChange={(e) => setAddress(e.target.value)} className={field} maxLength={200} /></label>
      </div>
      {error && <p role="alert" className={errText}>{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={busy} className={ghostBtn}>Cancelar</button>
        <button type="button" onClick={save} disabled={busy} className={primaryBtn}>{busy ? 'Guardando…' : 'Crear y usar este cliente'}</button>
      </div>
    </div>
  )
}

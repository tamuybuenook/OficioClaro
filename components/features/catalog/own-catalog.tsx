'use client'

import { useState } from 'react'
import { Pencil, Plus, Search } from 'lucide-react'
import { createCatalogItem, listOwnCatalog, setCatalogItemActive, updateCatalogItem, type OwnCatalogPage } from '@/lib/actions/catalogItems'
import { useCachedQuery } from '@/lib/cache/use-cached-query'
import { invalidate } from '@/lib/cache/store'
import { UNIT_PRESETS, type CatalogFieldErrors } from '@/lib/catalogItems'
import type { OwnCatalogItem } from '@/lib/quotes'
import { acceptLocalChange } from '@/lib/cache/sync'
import { fetchSyncStamp } from '@/lib/actions/quoteBuilder'
import { card, coralBtn, errText, field, fieldLabel, ghostBtn, money, primaryBtn, useDebounced } from '@/components/features/quotes/ui'

// "Mi catálogo": cada profesional crea y mantiene sus propios artículos y servicios.
// Se usan directamente al presupuestar. Desactivar un concepto NO altera presupuestos ya emitidos.

type Draft = { id: string | null; name: string; description: string; category: string; unit_label: string; price: string }
const empty: Draft = { id: null, name: '', description: '', category: '', unit_label: 'Unidad', price: '' }
const toDraft = (i: OwnCatalogItem): Draft => ({ id: i.id, name: i.name, description: i.description ?? '', category: i.category ?? '', unit_label: i.unit_label, price: String(i.unit_price).replace('.', ',') })

async function afterChange() {
  // 1) se descarta lo guardado en ESTE dispositivo (las listas se vuelven a pedir)  2) se anota el sello nuevo para no contar el cambio propio como ajeno
  await invalidate('catalogo:'); await invalidate('concepts:own')
  await acceptLocalChange(async () => { const r = await fetchSyncStamp(); return 'error' in r ? null : r.data })
}

export function OwnCatalogView() {
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [pages, setPages] = useState(1)
  const [editor, setEditor] = useState<Draft | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const dq = useDebounced(q.trim(), 250)

  return (
    <div className="mx-auto max-w-[860px] p-5 pb-28 md:p-8">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm text-[var(--oc-muted)]">Tus artículos y servicios con tu precio</p><h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Mi catálogo</h1></div>
        {!editor && <button type="button" onClick={() => { setMessage(null); setEditor({ ...empty }) }} className={coralBtn}>+ Nuevo concepto</button>}
      </div>

      {message && <p role="status" className="mt-4 rounded-xl bg-[var(--oc-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--oc-ink)]">{message}</p>}

      {editor && <CatalogForm draft={editor} onCancel={() => setEditor(null)} onSaved={async (msg) => { setEditor(null); setMessage(msg); await afterChange() }} />}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Buscar en mi catálogo</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--oc-muted)]" aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPages(1) }} placeholder="Buscar por nombre o categoría…" className={`${field} pl-9`} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--oc-muted)]"><input type="checkbox" checked={showInactive} onChange={(e) => { setShowInactive(e.target.checked); setPages(1) }} className="size-5" />Mostrar desactivados</label>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {Array.from({ length: pages }, (_, i) => (
          <CatalogPage key={`${dq}-${showInactive}-${i}`} q={dq} inactive={showInactive} page={i + 1} last={i + 1 === pages} onMore={() => setPages((p) => p + 1)}
            onEdit={(it) => { setMessage(null); setEditor(toDraft(it)) }}
            onToggle={async (it) => {
              const r = await setCatalogItemActive(it.id, !it.is_active)
              if ('error' in r) { setMessage(r.error); return }
              setMessage(r.data.is_active ? `“${it.name}” se reactivó.` : `“${it.name}” se desactivó. Tus presupuestos anteriores no cambian.`)
              await afterChange()
            }} onCreate={() => setEditor({ ...empty, name: dq })} />
        ))}
      </div>
    </div>
  )
}

function CatalogPage({ q, inactive, page, last, onMore, onEdit, onToggle, onCreate }: {
  q: string; inactive: boolean; page: number; last: boolean; onMore: () => void
  onEdit: (i: OwnCatalogItem) => void; onToggle: (i: OwnCatalogItem) => Promise<void>; onCreate: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const { data, loading, refreshing, error, reload } = useCachedQuery<OwnCatalogPage>(
    'catalogo:list', { q: q.toLowerCase(), inactive, page },
    async () => { const r = await listOwnCatalog({ q, includeInactive: inactive, page }); return 'error' in r ? { error: r.error } : r },
    { ttlMs: 5 * 60_000 },
  )
  if (loading && !data) return <p className="text-sm text-[var(--oc-muted)]" role="status">Cargando tu catálogo…</p>
  if (error && !data) return <div><p role="alert" className={errText}>{error}</p><button type="button" onClick={reload} className="min-h-11 text-sm font-bold text-[var(--oc-brand)] underline">Reintentar</button></div>
  if (!data) return null
  if (data.items.length === 0 && page === 1) {
    return (
      <div className={`${card} text-sm text-[var(--oc-muted)]`}>
        {q ? <p>No encontramos conceptos para “{q}”.</p> : <p>Todavía no cargaste conceptos propios. Creá tus artículos y servicios con tu precio y usalos al presupuestar.</p>}
        <button type="button" onClick={onCreate} className="mt-2 min-h-11 font-bold text-[var(--oc-brand)] underline">Crear un concepto</button>
      </div>
    )
  }
  return (
    <>
      {error && <p role="status" className="text-xs text-[var(--oc-muted)]">Mostrando datos guardados en tu dispositivo. {error}</p>}
      {data.items.map((it) => (
        <div key={it.id} className={`${card} ${refreshing ? 'opacity-80' : ''} ${it.is_active ? '' : 'opacity-70'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words font-bold text-[var(--oc-ink)]">{it.name}{!it.is_active && <span className="ml-2 text-xs font-semibold text-[var(--oc-muted)]">(desactivado)</span>}</p>
              <p className="text-xs text-[var(--oc-muted)]">{[it.category, it.unit_label].filter(Boolean).join(' · ')}</p>
              {it.description && <p className="mt-1 break-words text-sm text-[var(--oc-muted)]">{it.description}</p>}
            </div>
            <p className="shrink-0 text-lg font-bold text-[var(--oc-brand)]">{money(it.unit_price)}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => onEdit(it)} className={`${ghostBtn} flex items-center gap-1`}><Pencil className="size-4" aria-hidden="true" />Editar</button>
            <button type="button" disabled={busyId === it.id} onClick={async () => { setBusyId(it.id); try { await onToggle(it) } finally { setBusyId(null) } }} className={ghostBtn}>{it.is_active ? 'Desactivar' : 'Reactivar'}</button>
          </div>
        </div>
      ))}
      {last && data.total > page * data.pageSize && <button type="button" onClick={onMore} className={ghostBtn}><Plus className="mr-1 inline size-4" aria-hidden="true" />Ver más</button>}
    </>
  )
}

function CatalogForm({ draft, onCancel, onSaved }: { draft: Draft; onCancel: () => void; onSaved: (message: string) => Promise<void> }) {
  const [d, setD] = useState(draft)
  const [errors, setErrors] = useState<CatalogFieldErrors & { form?: string }>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((p) => ({ ...p, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErrors({})
    try {
      const input = { name: d.name, description: d.description, category: d.category, unit_label: d.unit_label, price: d.price }
      const res = d.id ? await updateCatalogItem(d.id, input) : await createCatalogItem(input)
      if ('error' in res) { setErrors({ ...(res.fieldErrors ?? {}), form: res.fieldErrors ? undefined : res.error }); return }
      await onSaved(d.id ? 'Cambios guardados. Los presupuestos que ya armaste conservan su precio.' : `“${res.data.name}” se agregó a tu catálogo.`)
    } catch {
      setErrors({ form: 'No se pudo guardar. Revisá tu conexión e intentá de nuevo: lo que escribiste sigue acá.' })
    } finally { setBusy(false) }
  }

  const bad = (k: keyof CatalogFieldErrors) => !!errors[k]
  return (
    <form onSubmit={submit} aria-busy={busy} className={`mt-5 grid gap-4 ${card}`}>
      <h2 className="text-base font-bold text-[var(--oc-ink)]">{d.id ? 'Editar concepto' : 'Nuevo concepto'}</h2>
      <label className={fieldLabel}>Nombre<input value={d.name} onChange={set('name')} maxLength={120} required className={field} aria-invalid={bad('name')} />{errors.name && <span role="alert" className={errText}>{errors.name}</span>}</label>
      <label className={fieldLabel}>Descripción (opcional)<textarea value={d.description} onChange={set('description')} rows={2} maxLength={500} className={`${field} resize-y`} />{errors.description && <span role="alert" className={errText}>{errors.description}</span>}</label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={fieldLabel}>Precio unitario<input value={d.price} onChange={set('price')} inputMode="decimal" placeholder="0" required className={field} aria-invalid={bad('price')} />{errors.price && <span role="alert" className={errText}>{errors.price}</span>}</label>
        <label className={fieldLabel}>Unidad de medida<input value={d.unit_label} onChange={set('unit_label')} list="oc-units-cat" maxLength={20} className={field} aria-invalid={bad('unit_label')} />{errors.unit_label && <span role="alert" className={errText}>{errors.unit_label}</span>}</label>
        <label className={fieldLabel}>Categoría (opcional)<input value={d.category} onChange={set('category')} maxLength={60} className={field} />{errors.category && <span role="alert" className={errText}>{errors.category}</span>}</label>
      </div>
      <datalist id="oc-units-cat">{UNIT_PRESETS.map((u) => <option key={u} value={u} />)}</datalist>
      {errors.form && <p role="alert" className="rounded-xl bg-[var(--oc-danger-bg)] px-4 py-3 text-sm font-semibold text-[var(--oc-coral)]">{errors.form}</p>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={busy} className={ghostBtn}>Cancelar</button>
        <button type="submit" disabled={busy} className={primaryBtn}>{busy ? 'Guardando…' : d.id ? 'Guardar cambios' : 'Guardar concepto'}</button>
      </div>
    </form>
  )
}

'use client'

import { useState } from 'react'
import { PackagePlus, Plus, Search } from 'lucide-react'
import { searchConcepts } from '@/lib/actions/quoteBuilder'
import { createCatalogItem } from '@/lib/actions/catalogItems'
import { useCachedQuery } from '@/lib/cache/use-cached-query'
import { invalidate } from '@/lib/cache/store'
import { cleanCatalogInput, UNIT_PRESETS } from '@/lib/catalogItems'
import type { Concept, ConceptPage } from '@/lib/quotes'
import { errText, field, fieldLabel, ghostBtn, money, primaryBtn, useDebounced } from './ui'

// Búsqueda y alta de conceptos DENTRO del formulario del presupuesto. Nada de esto pierde lo ya cargado:
// el formulario solo recibe `onAdd` y suma una línea.

type Scope = 'own' | 'service'
export type CustomConcept = { description: string; unit: string; price: number; catalogItemId: string | null }

export function ConceptFinder({ onAdd, onAddCustom }: { onAdd: (c: Concept) => void; onAddCustom: (c: CustomConcept) => void }) {
  const [scope, setScope] = useState<Scope>('own')
  const [q, setQ] = useState('')
  const [pages, setPages] = useState(1)
  const [creating, setCreating] = useState(false)
  const dq = useDebounced(q.trim(), 250)

  return (
    <div className="grid gap-3">
      <div role="tablist" aria-label="Origen de los conceptos" className="flex gap-2">
        {([['own', 'Mi catálogo'], ['service', 'Lista de precios']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={scope === id} onClick={() => { setScope(id); setPages(1) }}
            className={`min-h-11 rounded-full px-4 text-sm font-bold ${scope === id ? 'bg-[var(--oc-brand)] text-white' : 'border border-[var(--oc-border)] text-[var(--oc-muted)]'}`}>{label}</button>
        ))}
      </div>

      <label className="relative block">
        <span className="sr-only">Buscar trabajos o artículos</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--oc-muted)]" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPages(1) }} placeholder={scope === 'own' ? 'Buscar en tu catálogo por nombre o categoría…' : 'Buscar en la lista de precios…'} className={`${field} pl-9`} autoComplete="off" />
      </label>

      <div className="rounded-xl border border-[var(--oc-border)]">
        {Array.from({ length: pages }, (_, i) => (
          <ResultsPage key={`${scope}-${dq}-${i + 1}`} scope={scope} q={dq} page={i + 1} last={i + 1 === pages} onMore={() => setPages((p) => p + 1)} onAdd={onAdd} onCreate={() => setCreating(true)} />
        ))}
      </div>

      {creating
        ? <NewConceptInline initialName={q.trim()} onCancel={() => setCreating(false)} onAdd={(c) => { onAddCustom(c); setCreating(false) }} />
        : <button type="button" onClick={() => setCreating(true)} className="flex min-h-11 items-center gap-2 self-start px-1 text-sm font-bold text-[var(--oc-brand)]"><PackagePlus className="size-4" aria-hidden="true" />Crear un concepto nuevo</button>}
    </div>
  )
}

function ResultsPage({ scope, q, page, last, onMore, onAdd, onCreate }: {
  scope: Scope; q: string; page: number; last: boolean; onMore: () => void; onAdd: (c: Concept) => void; onCreate: () => void
}) {
  const { data, loading, refreshing, error, reload } = useCachedQuery<ConceptPage>(
    `concepts:${scope}`, { q: q.toLowerCase(), page },
    async () => { const r = await searchConcepts({ scope, q, page }); return 'error' in r ? { error: r.error } : r },
    { ttlMs: 5 * 60_000 },
  )

  if (loading && !data) return <p className="p-3 text-sm text-[var(--oc-muted)]" role="status">Buscando…</p>
  if (error && !data) return <div className="p-3"><p role="alert" className={errText}>{error}</p><button type="button" onClick={reload} className="mt-1 min-h-11 text-sm font-bold text-[var(--oc-brand)] underline">Reintentar</button></div>
  if (!data) return null

  if (data.items.length === 0 && page === 1) {
    return (
      <div className="p-3 text-sm text-[var(--oc-muted)]">
        {q ? <p>No encontramos resultados para “{q}”.</p>
          : scope === 'own' ? <p>Todavía no cargaste conceptos propios. Podés crear uno ahora o desde “Mi catálogo”.</p>
          : <p>No hay trabajos en tu lista de precios. Revisá que tengas oficios activos.</p>}
        <button type="button" onClick={onCreate} className="mt-1 min-h-11 font-bold text-[var(--oc-brand)] underline">Crear un concepto nuevo</button>
      </div>
    )
  }
  const hasMore = data.total > page * data.pageSize
  return (
    <div>
      {error && <p role="status" className="px-3 pt-2 text-xs text-[var(--oc-muted)]">Mostrando datos guardados en tu dispositivo. {error}</p>}
      <ul className={`divide-y divide-[var(--oc-border-soft)] ${page > 1 ? 'border-t border-[var(--oc-border-soft)]' : ''} ${refreshing ? 'opacity-80' : ''}`}>
        {data.items.map((c) => (
          <li key={`${c.kind}-${c.id}`} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-bold text-[var(--oc-ink)]">{c.name}</p>
              <p className="truncate text-xs text-[var(--oc-muted)]">{[c.category, c.unit].filter(Boolean).join(' · ')}</p>
            </div>
            <p className="shrink-0 text-sm font-bold text-[var(--oc-brand)]">{money(c.price)}</p>
            <button type="button" onClick={() => onAdd(c)} aria-label={`Agregar ${c.name}`} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-[var(--oc-brand)] px-3 text-sm font-bold text-white"><Plus className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Agregar</span></button>
          </li>
        ))}
      </ul>
      {last && hasMore && <button type="button" onClick={onMore} className="min-h-11 w-full border-t border-[var(--oc-border-soft)] text-sm font-bold text-[var(--oc-brand)]">Ver más resultados</button>}
    </div>
  )
}

function NewConceptInline({ initialName, onCancel, onAdd }: { initialName: string; onCancel: () => void; onAdd: (c: CustomConcept) => void }) {
  const [name, setName] = useState(initialName)
  const [unit, setUnit] = useState('Unidad')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState('')
  const [save, setSave] = useState(true)
  const [errors, setErrors] = useState<Partial<Record<'name' | 'price' | 'form', string>>>({})
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    const clean = cleanCatalogInput({ name, description: '', category, unit_label: unit, price: price || '0' })
    if (!clean.value) { setErrors({ name: clean.errors?.name, price: clean.errors?.price }); return }
    const v = clean.value
    setErrors({})
    if (!save) { onAdd({ description: v.name, unit: v.unit_label, price: v.unit_price, catalogItemId: null }); return }
    setBusy(true)
    try {
      const res = await createCatalogItem({ name, description: '', category, unit_label: unit, price: price || '0' })
      if ('error' in res) { setErrors({ name: res.fieldErrors?.name, price: res.fieldErrors?.price, form: res.fieldErrors ? undefined : res.error }); return }
      await invalidate('concepts:own'); await invalidate('catalogo:')
      onAdd({ description: res.data.name, unit: res.data.unit_label, price: Number(res.data.unit_price), catalogItemId: res.data.id })
    } catch {
      setErrors({ form: 'No se pudo guardar en tu catálogo. Podés agregarlo solo a este presupuesto desmarcando la opción. Lo que cargaste no se perdió.' })
    } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-page)] p-3" role="group" aria-label="Concepto nuevo">
      <p className="text-sm font-bold text-[var(--oc-ink)]">Concepto nuevo</p>
      <label className={fieldLabel}>Nombre<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={field} aria-invalid={!!errors.name} />{errors.name && <span role="alert" className={errText}>{errors.name}</span>}</label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={fieldLabel}>Precio unitario<input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0" className={field} aria-invalid={!!errors.price} />{errors.price && <span role="alert" className={errText}>{errors.price}</span>}</label>
        <label className={fieldLabel}>Unidad<input value={unit} onChange={(e) => setUnit(e.target.value)} list="oc-units" maxLength={20} className={field} /></label>
        <label className={fieldLabel}>Categoría (opcional)<input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} className={field} /></label>
      </div>
      <datalist id="oc-units">{UNIT_PRESETS.map((u) => <option key={u} value={u} />)}</datalist>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-[var(--oc-ink)]">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="size-5" />
        Guardarlo también en mi catálogo para usarlo en otros presupuestos
      </label>
      {errors.form && <p role="alert" className={errText}>{errors.form}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={busy} className={ghostBtn}>Cancelar</button>
        <button type="button" onClick={submit} disabled={busy} className={primaryBtn}>{busy ? 'Guardando…' : 'Agregar al presupuesto'}</button>
      </div>
    </div>
  )
}

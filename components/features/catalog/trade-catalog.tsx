'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { fetchCategoryPage, fetchTradeCategories, type CategoryCount, type CategoryPage } from '@/lib/actions/catalogPage'
import { money } from '@/lib/format'
import type { Job } from '@/components/types'

type Trade = { id: string; name: string }
const TAB_KEY = 'oficioclaro-active-trade'
// Fila horizontal única: nunca se apila ni ensancha la página; el desplazamiento queda dentro de la propia barra.
const SCROLL_ROW = 'flex w-full min-w-0 max-w-full flex-row flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 snap-x max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden'

// Una pestaña por rubro (oficio) habilitado. Las pestañas visitadas se mantienen montadas (ocultas) para conservar
// su búsqueda y la página de cada categoría al cambiar de pestaña.
export function TradeCatalog({ trades, mode, onOpen }: { trades: Trade[]; mode: 'master' | 'mine'; onOpen: (job: Job) => void }) {
  const [active, setActive] = useState<string>(trades[0]?.id ?? '')
  const [visited, setVisited] = useState<string[]>(trades[0] ? [trades[0].id] : [])

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(TAB_KEY)
      if (saved && trades.some((t) => t.id === saved)) select(saved)
    } catch { /* sin almacenamiento */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function select(id: string) {
    setActive(id)
    setVisited((v) => (v.includes(id) ? v : [...v, id]))
    try { window.sessionStorage.setItem(TAB_KEY, id) } catch { /* noop */ }
  }

  function onKey(e: React.KeyboardEvent, i: number) {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    const t = trades[(next + trades.length) % trades.length]
    select(t.id)
    document.getElementById(`tab-${t.id}`)?.focus()
  }

  // La pestaña activa se acerca a la vista dentro de la barra (sin mover la página).
  useEffect(() => {
    const el = document.getElementById(`tab-${active}`)
    const bar = el?.parentElement
    if (!el || !bar) return
    const left = el.offsetLeft - (bar.clientWidth - el.offsetWidth) / 2
    bar.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [active])

  return (
    <div className="min-w-0 max-w-full">
      <div role="tablist" aria-label="Rubros" className={`${SCROLL_ROW} mb-3`}>
        {trades.map((t, i) => (
          <button key={t.id} id={`tab-${t.id}`} role="tab" aria-selected={active === t.id} aria-controls={`panel-${t.id}`} tabIndex={active === t.id ? 0 : -1} onClick={() => select(t.id)} onKeyDown={(e) => onKey(e, i)}
            className={`inline-flex min-h-11 w-auto shrink-0 snap-start items-center whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-brand)] ${active === t.id ? 'bg-[var(--oc-coral)] text-white' : 'border border-[var(--oc-border)] text-[var(--oc-muted)]'}`}>{t.name}</button>
        ))}
      </div>
      {trades.filter((t) => visited.includes(t.id)).map((t) => (
        <div key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-labelledby={`tab-${t.id}`} hidden={active !== t.id} className="min-w-0">
          <TradePanel tradeId={t.id} mode={mode} onOpen={onOpen} />
        </div>
      ))}
    </div>
  )
}

function TradePanel({ tradeId, mode, onOpen }: { tradeId: string; mode: 'master' | 'mine'; onOpen: (job: Job) => void }) {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [cats, setCats] = useState<CategoryCount[] | null>(null)
  const [catId, setCatId] = useState<string | null>(null) // subcategoría elegida
  const [pages, setPages] = useState<Record<string, number>>({}) // página propia de cada subcategoría

  // Búsqueda con pequeña demora; al cambiar el texto se recargan las subcategorías y cada una vuelve a la página 1.
  useEffect(() => { const h = setTimeout(() => setQ(input.trim()), 300); return () => clearTimeout(h) }, [input])
  useEffect(() => {
    let live = true
    setCats(null)
    setPages({})
    fetchTradeCategories(tradeId, q).then((c) => { if (live) setCats(c) }).catch(() => { if (live) setCats([]) })
    return () => { live = false }
  }, [tradeId, q])

  // Si la subcategoría elegida ya no tiene resultados (por la búsqueda), se usa la primera disponible.
  const current = cats?.find((c) => c.id === catId) ?? cats?.[0] ?? null

  function onKey(e: React.KeyboardEvent, i: number) {
    if (!cats) return
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    const c = cats[(next + cats.length) % cats.length]
    setCatId(c.id)
    document.getElementById(`chip-${c.id}`)?.focus()
  }

  return (
    <div className="min-w-0">
      {cats && cats.length > 0 && (
        <div role="group" aria-label="Subcategorías" className={`${SCROLL_ROW} mb-3`}>
          {cats.map((c, i) => {
            const on = current?.id === c.id
            return (
              <button key={c.id} id={`chip-${c.id}`} type="button" aria-pressed={on} onClick={() => setCatId(c.id)} onKeyDown={(e) => onKey(e, i)}
                className={`inline-flex min-h-9 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-brand)] ${on ? 'bg-[var(--oc-brand)] text-[var(--oc-on-brand)]' : 'border border-[var(--oc-border)] bg-[var(--oc-surface)] text-[var(--oc-muted)]'}`}>
                {c.name}<span className={on ? 'opacity-80' : 'opacity-70'}>{c.count}</span>
              </button>
            )
          })}
        </div>
      )}
      <label className="flex h-14 items-center gap-3 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-4 shadow-sm focus-within:ring-4 focus-within:ring-[var(--oc-brand-soft)]">
        <Search className="size-5 shrink-0 text-[var(--oc-muted)]" aria-hidden="true" />
        <span className="sr-only">Buscar un trabajo en este rubro</span>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Buscar un trabajo..." className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--oc-ink)] outline-none placeholder:text-[var(--oc-muted)]" />
      </label>
      <div className="mt-4" aria-live="polite">
        {cats === null && <p className="text-sm text-[var(--oc-muted)]">Cargando…</p>}
        {cats?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--oc-border)] p-10 text-center">
            <p className="font-semibold text-[var(--oc-ink)]">{q ? 'No encontramos ese trabajo' : 'Todavía no hay trabajos en este rubro'}</p>
            {q && <p className="mt-1 text-sm text-[var(--oc-muted)]">Probá con otra palabra, como “canilla” o “calefón”.</p>}
          </div>
        )}
        {current && (
          <CategorySection key={`${current.id}|${q}`} tradeId={tradeId} cat={current} q={q} mode={mode} onOpen={onOpen}
            page={pages[current.id] ?? 1} onPage={(p) => setPages((m) => ({ ...m, [current.id]: p }))} />
        )}
      </div>
    </div>
  )
}

function CategorySection({ tradeId, cat, q, mode, onOpen, page, onPage }: { tradeId: string; cat: CategoryCount; q: string; mode: 'master' | 'mine'; onOpen: (job: Job) => void; page: number; onPage: (p: number) => void }) {
  const [data, setData] = useState<CategoryPage | null>(null)
  const [loading, setLoading] = useState(true)
  const headRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    fetchCategoryPage(tradeId, cat.id, q, page).then((d) => { if (live) { setData(d); setLoading(false) } }).catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [tradeId, cat.id, q, page])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const go = (p: number) => { onPage(p); headRef.current?.scrollIntoView({ block: 'nearest' }) }

  return (
    <section className="mb-4" aria-labelledby={`cat-${cat.id}`}>
      <h3 id={`cat-${cat.id}`} ref={headRef} className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--oc-brand)]">{cat.name} <span className="font-semibold text-[var(--oc-muted)]">· {data?.total ?? cat.count}</span></h3>
      <div className={`flex flex-col divide-y divide-[var(--oc-border-soft)] rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] ${loading ? 'opacity-60' : ''}`}>
        {data?.jobs.map((job) => {
          const main = mode === 'master' ? { label: 'General', value: job.regional } : { label: 'Mi precio', value: job.personal }
          return (
            <button key={job.id} onClick={() => onOpen(job)} className="flex min-h-14 items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-[var(--oc-surface-muted)] sm:px-4 sm:py-4">
              <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--oc-ink)]">{job.name}</span><span className="mt-1 block text-xs text-[var(--oc-muted)]">{job.category} · {job.unit}</span></span>
              <span className="shrink-0 text-right"><span className="block text-sm font-bold text-[var(--oc-brand)]">{money(main.value)}</span><span className="text-[11px] text-[var(--oc-muted)]">{main.label}</span></span>
            </button>
          )
        })}
        {!data && loading && <p className="p-4 text-sm text-[var(--oc-muted)]">Cargando…</p>}
      </div>
      {totalPages > 1 && (
        <nav aria-label={`Páginas de ${cat.name}`} className="mt-3 flex items-center justify-between gap-3">
          <button disabled={page <= 1 || loading} onClick={() => go(page - 1)} className="flex min-h-10 items-center gap-1 rounded-lg border border-[var(--oc-border)] px-3 text-xs font-bold text-[var(--oc-brand)] disabled:opacity-40"><ChevronLeft className="size-4" />Anterior</button>
          <span className="text-xs font-semibold text-[var(--oc-muted)]">Página {page} de {totalPages}</span>
          <button disabled={page >= totalPages || loading} onClick={() => go(page + 1)} className="flex min-h-10 items-center gap-1 rounded-lg border border-[var(--oc-border)] px-3 text-xs font-bold text-[var(--oc-brand)] disabled:opacity-40">Siguiente<ChevronRight className="size-4" /></button>
        </nav>
      )}
    </section>
  )
}

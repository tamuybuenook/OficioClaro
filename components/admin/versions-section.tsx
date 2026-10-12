'use client'

import { useState, useTransition } from 'react'
import { createVersion, generateItemsFromUt, publishVersion, getVersionReview, discardDraftVersion, type VersionValidation } from '@/lib/actions/priceLists'

export type Version = {
  id: string
  version_label: string
  status: 'draft' | 'published'
  effective_date: string
  reference_ut_value: number | null
  source_ipc_id: string | null
  published_at: string | null
  price_lists: { trade_id: string }
  price_items: { count: number }[] | null
}

type Review = {
  version: any
  validation: VersionValidation
  items: { id: string; name: string; unit: string; ut: number | null; price: number; expected: number | null; differs: boolean }[]
}

const money = (v: number) => `$${v.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const fmtDate = (d: string) => d.split('-').reverse().join('/')

function StatusBadge({ v }: { v: Version }) {
  const published = v.status === 'published'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${published ? 'bg-[var(--oc-success-bg)] text-[var(--oc-success-text)]' : 'bg-[var(--oc-blue-bg)] text-[var(--oc-blue-text)]'}`}>
      {published ? 'Publicada' : 'Borrador'}
    </span>
  )
}

export function VersionsSection({ priceListId, versions, masterUtValue, tradeName }: { priceListId: string | null; versions: Version[]; masterUtValue: number | null; tradeName: string }) {
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)

  const sorted = [...versions].sort((a, b) => b.effective_date.localeCompare(a.effective_date))

  function loadReview(id: string) {
    setReviewId(id)
    startTransition(async () => {
      const res = await getVersionReview(id)
      if ('error' in res) { setNotice({ kind: 'error', text: res.error ?? 'Error' }); setReview(null); return }
      setReview(res.data as Review)
    })
  }

  function newVersion() {
    if (!priceListId) return
    const label = window.prompt(`Nombre de la nueva versión de ${tradeName} (ej: Noviembre 2026)`)
    if (!label) return
    const date = window.prompt('Fecha de vigencia (AAAA-MM-DD)', '')
    if (!date) return
    const fd = new FormData()
    fd.set('version_label', label)
    fd.set('effective_date', date)
    startTransition(async () => {
      const res = await createVersion(priceListId, fd)
      if ('error' in res) { setNotice({ kind: 'error', text: res.error ?? 'Error' }); return }
      setNotice({ kind: 'ok', text: res.data.created ? `Versión "${label}" creada en borrador.` : `La versión "${label}" ya existía; no se duplicó.` })
    })
  }

  function generate(v: Version) {
    if (!masterUtValue) { setNotice({ kind: 'error', text: 'Primero cargá un valor de UT maestro.' }); return }
    const ok = window.confirm(
      `Se recalcularán los precios de "${v.version_label}" con la UT maestra vigente el ${fmtDate(v.effective_date)} (no la de hoy) y quedará guardada como valor de referencia. ` +
      'Los precios cargados a mano de servicios con UT se reemplazan. ¿Confirmás?',
    )
    if (!ok) return
    startTransition(async () => {
      const res = await generateItemsFromUt(v.id)
      if ('error' in res) { setNotice({ kind: 'error', text: res.error ?? 'Error' }); return }
      const d = res.data
      setNotice({ kind: 'ok', text: `Precios generados con UT ${money(d.reference_ut_value)}: ${d.inserted} nuevos, ${d.updated} actualizados, ${d.unchanged} sin cambios. ${d.services_without_ut} servicio(s) sin UT requieren precio manual.` })
      if (reviewId === v.id) loadReview(v.id)
    })
  }

  function publish(v: Version) {
    if (!window.confirm(`¿Publicar "${v.version_label}"? Quedará vigente desde ${fmtDate(v.effective_date)} y NO se podrá modificar después.`)) return
    startTransition(async () => {
      const res = await publishVersion(v.id)
      if ('error' in res) { setNotice({ kind: 'error', text: res.error ?? 'Error' }); return }
      setNotice({ kind: 'ok', text: `"${v.version_label}" publicada.${res.data.warnings.length ? ` Advertencias: ${res.data.warnings.join(' ')}` : ''}` })
      setReview(null); setReviewId(null)
    })
  }

  function discard(v: Version) {
    if (!window.confirm(`¿Descartar el borrador "${v.version_label}"? Se eliminan sus ítems (queda un respaldo en el registro de auditoría). Las versiones publicadas no se tocan.`)) return
    startTransition(async () => {
      const res = await discardDraftVersion(v.id)
      if ('error' in res) { setNotice({ kind: 'error', text: res.error ?? 'Error' }); return }
      setNotice({ kind: 'ok', text: `Borrador "${v.version_label}" descartado (${res.data.items_backed_up} ítem(s) respaldados).` })
      setReview(null); setReviewId(null)
    })
  }

  return (
    <div className="mt-4 rounded-xl bg-[var(--oc-surface-muted)] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--oc-muted)]">Versiones de la lista maestra</p>
        {priceListId && <button disabled={pending} onClick={newVersion} className="text-xs font-bold text-[var(--oc-brand)] disabled:opacity-60">+ Nueva versión</button>}
      </div>

      {!priceListId && <p className="mt-2 text-xs text-[var(--oc-muted)]">Este oficio todavía no tiene lista maestra creada.</p>}
      {priceListId && sorted.length === 0 && <p className="mt-2 text-xs text-[var(--oc-muted)]">Todavía no hay versiones. Creá la primera con “+ Nueva versión”.</p>}

      {notice && (
        <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${notice.kind === 'error' ? 'bg-[#fdecea] text-[var(--oc-coral)]' : 'bg-[var(--oc-success-bg)] text-[var(--oc-success-text)]'}`}>
          {notice.text}
        </p>
      )}

      {sorted.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead><tr className="text-[var(--oc-muted)]"><th className="py-1.5">Versión</th><th>Estado</th><th>Vigencia</th><th>UT ref.</th><th>Ítems</th><th></th></tr></thead>
            <tbody>
              {sorted.map((v) => (
                <tr key={v.id} className="border-t border-[var(--oc-border-soft)]">
                  <td className="py-2 font-semibold">{v.version_label}{v.source_ipc_id && <span className="ml-1 text-[10px] font-normal text-[var(--oc-muted)]">(por IPC)</span>}</td>
                  <td><StatusBadge v={v} /></td>
                  <td>{fmtDate(v.effective_date)}</td>
                  <td>{v.reference_ut_value != null ? money(v.reference_ut_value) : '—'}</td>
                  <td>{v.price_items?.[0]?.count ?? 0}</td>
                  <td className="space-x-2 text-right">
                    <button disabled={pending} onClick={() => loadReview(v.id)} className="font-bold text-[var(--oc-brand)] disabled:opacity-60">{v.status === 'draft' ? 'Revisar' : 'Ver'}</button>
                    {v.status === 'draft' && !v.source_ipc_id && <button disabled={pending} onClick={() => generate(v)} className="font-bold text-[var(--oc-brand)] disabled:opacity-60">Generar desde UT</button>}
                    {v.status === 'draft' && <button disabled={pending} onClick={() => discard(v)} className="font-bold text-[var(--oc-coral)] disabled:opacity-60">Descartar</button>}
                    {v.status === 'draft' && <button disabled={pending} onClick={() => publish(v)} className="rounded-lg border border-[var(--oc-border)] px-2 py-1 font-bold disabled:opacity-60">Publicar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending && !review && reviewId && <p className="mt-3 text-xs text-[var(--oc-muted)]">Cargando revisión…</p>}

      {review && (
        <div className="mt-4 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">{review.version?.version_label} · {review.validation.item_count} ítem(s)</p>
            <button onClick={() => { setReview(null); setReviewId(null) }} className="text-xs font-bold text-[var(--oc-muted)]">Cerrar</button>
          </div>
          {review.validation.errors.length > 0 && (
            <ul className="mt-2 list-disc rounded-lg bg-[#fdecea] py-2 pl-6 pr-3 text-xs font-semibold text-[var(--oc-coral)]">
              {review.validation.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          {review.validation.warnings.length > 0 && (
            <ul className="mt-2 list-disc rounded-lg bg-[var(--oc-surface-muted)] py-2 pl-6 pr-3 text-xs text-[var(--oc-ink)]">
              {review.validation.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          {review.validation.errors.length === 0 && review.version?.status === 'draft' && <p className="mt-2 text-xs font-semibold text-[var(--oc-success-text)]">Sin errores bloqueantes: se puede publicar.</p>}
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="w-full min-w-[460px] text-left text-xs">
              <thead><tr className="text-[var(--oc-muted)]"><th className="py-1.5">Trabajo</th><th>UT</th><th>Precio</th><th>UT × ref.</th></tr></thead>
              <tbody>
                {review.items.map((i) => (
                  <tr key={i.id} className={`border-t border-[var(--oc-border-soft)] ${i.differs ? 'bg-[#fff6e5]' : ''}`}>
                    <td className="py-1.5">{i.name}</td>
                    <td>{i.ut ?? '—'}</td>
                    <td className="font-bold">{money(i.price)}</td>
                    <td>{i.expected != null ? money(i.expected) : '—'}{i.differs && <span className="ml-1 font-bold text-[var(--oc-coral)]">≠</span>}</td>
                  </tr>
                ))}
                {review.items.length === 0 && <tr><td colSpan={4} className="py-3 text-[var(--oc-muted)]">Sin ítems todavía.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

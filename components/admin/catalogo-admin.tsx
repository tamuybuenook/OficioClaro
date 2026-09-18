'use client'

import { useState, useTransition } from 'react'
import { createService, updateService, deleteService } from '@/lib/actions/catalog'
import { createVersion, generateItemsFromUt, publishVersion } from '@/lib/actions/priceLists'
import { BulkLoadPanel } from '@/components/admin/bulk-load-panel'

type Trade = { id: string; name: string; slug: string }
type Category = { id: string; trade_id: string; name: string }
type Service = { id: string; category_id: string; name: string; unit_label: string; ut_coefficient: number | null }
type Version = { id: string; version_label: string; status: string; effective_date: string; reference_ut_value: number | null; price_lists: { trade_id: string } }
type PriceList = { id: string; trade_id: string }

export function CatalogoAdmin({ trades, categories, services, versions, priceLists }: { trades: Trade[]; categories: Category[]; services: Service[]; versions: Version[]; priceLists: PriceList[] }) {
  const [pending, startTransition] = useTransition()
  const [refUt, setRefUt] = useState<Record<string, string>>({})

  function editUt(service: Service) {
    const value = window.prompt(`UT para "${service.name}"`, String(service.ut_coefficient ?? ''))
    if (value === null) return
    const fd = new FormData()
    fd.set('name', service.name)
    fd.set('unit_label', service.unit_label)
    fd.set('ut_coefficient', value)
    startTransition(() => { updateService(service.id, fd) })
  }

  function addService(categoryId: string) {
    const name = window.prompt('Nombre del trabajo (ej: Cambio de canilla)')
    if (!name) return
    const ut = window.prompt('UT de esta tarea (ej: 2.5)')
    if (ut === null) return
    const fd = new FormData()
    fd.set('name', name)
    fd.set('unit_label', 'Trabajo')
    fd.set('ut_coefficient', ut)
    startTransition(() => { createService(categoryId, fd) })
  }

  function generate(version: Version) {
    const value = Number(refUt[version.id])
    if (!value || value <= 0) { window.alert('Cargá un valor de UT de referencia válido.'); return }
    const ok = window.confirm(`Vas a recalcular los precios de "${version.version_label}" usando UT = $${value.toLocaleString('es-AR')}. ¿Confirmás el ajuste?`)
    if (!ok) return
    startTransition(() => { generateItemsFromUt(version.id, value) })
  }

  function newVersion(priceListId: string) {
    const label = window.prompt('Nombre de la nueva versión (ej: Noviembre 2026)')
    if (!label) return
    const date = window.prompt('Fecha de vigencia (AAAA-MM-DD)')
    if (!date) return
    const fd = new FormData()
    fd.set('version_label', label)
    fd.set('effective_date', date)
    startTransition(() => { createVersion(priceListId, fd) })
  }

  return (
    <div className="mx-auto max-w-[1100px] p-5 pb-28 md:p-8">
      <p className="text-sm text-[var(--oc-muted)]">Administración</p>
      <h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Catálogo y precios por UT</h1>

      {trades.map((trade) => {
        const tradeCategories = categories.filter((c) => c.trade_id === trade.id)
        const tradeServices = services.filter((s) => tradeCategories.some((c) => c.id === s.category_id))
        const tradeVersions = versions.filter((v) => v.price_lists?.trade_id === trade.id)
        const draftVersion = tradeVersions.find((v) => v.status === 'draft')
        const priceList = priceLists.find((p) => p.trade_id === trade.id)

        return (
          <section key={trade.id} className="mt-6 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[var(--oc-ink)]">{trade.name}</h2>
              {tradeCategories[0] && <button onClick={() => addService(tradeCategories[0].id)} className="rounded-lg border border-[var(--oc-border)] px-3 py-1.5 text-xs font-bold">+ Trabajo</button>}
            </div>

            <table className="mt-3 w-full text-left text-sm">
              <thead><tr className="text-xs text-[var(--oc-muted)]"><th className="py-2">Oficio</th><th>Trabajo</th><th>UT</th><th></th></tr></thead>
              <tbody>
                {tradeServices.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--oc-border-soft)]">
                    <td className="py-2">{trade.name}</td>
                    <td>{s.name}</td>
                    <td className="font-bold">{s.ut_coefficient ?? '—'}</td>
                    <td className="text-right">
                      <button onClick={() => editUt(s)} className="mr-2 text-xs font-bold text-[var(--oc-brand)]">Editar UT</button>
                      <button onClick={() => { if (window.confirm(`¿Borrar "${s.name}"?`)) startTransition(() => { deleteService(s.id) }) }} className="text-xs font-bold text-[var(--oc-coral)]">Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3">
              <BulkLoadPanel tradeId={trade.id} tradeName={trade.name} />
            </div>

            <div className="mt-4 rounded-xl bg-[var(--oc-surface-muted)] p-4">
              {draftVersion ? (
                <>
                  <p className="text-xs font-semibold text-[var(--oc-muted)]">Versión en borrador: {draftVersion.version_label}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input placeholder="Valor UT de referencia" value={refUt[draftVersion.id] ?? ''} onChange={(e) => setRefUt({ ...refUt, [draftVersion.id]: e.target.value })} className="rounded-lg border border-[var(--oc-border)] px-3 py-2 text-sm" />
                    <button disabled={pending} onClick={() => generate(draftVersion)} className="rounded-lg bg-[var(--oc-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">Generar precios desde UT</button>
                    <button disabled={pending} onClick={() => { if (window.confirm('¿Publicar esta versión? No se podrá modificar después.')) startTransition(() => { publishVersion(draftVersion.id) }) }} className="rounded-lg border border-[var(--oc-border)] px-3 py-2 text-xs font-bold">Publicar</button>
                  </div>
                </>
              ) : priceList ? (
                <button disabled={pending} onClick={() => newVersion(priceList.id)} className="text-xs font-bold text-[var(--oc-brand)]">+ Nueva versión</button>
              ) : (
                <p className="text-xs text-[var(--oc-muted)]">Este oficio todavía no tiene lista maestra creada.</p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

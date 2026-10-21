'use client'

import { useState, useTransition } from 'react'
import { createService, updateService, deleteService, createCategory, createTradeWithList, updateTrade, setTradeActive } from '@/lib/actions/catalog'
import { setMasterUtValue } from '@/lib/actions/masterUt'
import { BulkLoadPanel } from '@/components/admin/bulk-load-panel'
import { VersionsSection, type Version } from '@/components/admin/versions-section'

type Trade = { id: string; name: string; slug: string; is_active: boolean }
type Category = { id: string; trade_id: string; name: string }
type Service = { id: string; category_id: string; name: string; unit_label: string; ut_coefficient: number | null }
type PriceList = { id: string; trade_id: string }

export function CatalogoAdmin({ trades, categories, services, versions, priceLists, masterUtValue }: { trades: Trade[]; categories: Category[]; services: Service[]; versions: Version[]; priceLists: PriceList[]; masterUtValue: number | null }) {
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // Ejecuta una acción y muestra su resultado (antes los errores se ignoraban en silencio).
  function run(fn: () => Promise<any>, okText: string) {
    startTransition(async () => {
      const res = await fn()
      if (res && typeof res === 'object' && 'error' in res && res.error) setNotice({ kind: 'error', text: res.error })
      else setNotice({ kind: 'ok', text: okText })
    })
  }

  function editUt(service: Service) {
    const value = window.prompt(`UT para "${service.name}"`, String(service.ut_coefficient ?? ''))
    if (value === null) return
    const fd = new FormData()
    fd.set('name', service.name)
    fd.set('unit_label', service.unit_label)
    fd.set('ut_coefficient', value)
    run(() => updateService(service.id, fd), 'UT actualizada.')
  }

  function changeMasterUt() {
    const value = window.prompt('Nuevo valor monetario de la UT maestro (queda historial, no se pisa el anterior)', String(masterUtValue ?? ''))
    if (!value) return
    const num = Number(value.replace(',', '.'))
    if (!num || num <= 0) { setNotice({ kind: 'error', text: 'El valor de UT debe ser un número mayor a cero.' }); return }
    run(() => setMasterUtValue(num), 'Valor de UT maestro actualizado (el anterior queda en el historial).')
  }

  function addService(categoryId: string | null, tradeId: string) {
    const name = window.prompt('Nombre del trabajo (ej: Cambio de canilla)')
    if (!name) return
    const ut = window.prompt('UT de esta tarea (ej: 2.5)')
    if (ut === null) return
    const fd = new FormData()
    fd.set('name', name)
    fd.set('unit_label', 'Trabajo')
    fd.set('ut_coefficient', ut)

    startTransition(async () => {
      let catId = categoryId
      if (!catId) {
        const categoryName = window.prompt('Todavía no hay categorías. Nombre de la primera (ej: General)') || 'General'
        const res = await createCategory(tradeId, (() => { const f = new FormData(); f.set('name', categoryName); return f })())
        if ('error' in res) { setNotice({ kind: 'error', text: res.error ?? 'Error' }); return }
        catId = res.data.id
      }
      if (!catId) return
      const res = await createService(catId, fd)
      setNotice('error' in res && res.error ? { kind: 'error', text: res.error } : { kind: 'ok', text: `Trabajo "${name}" creado.` })
    })
  }

  function addTrade() {
    const name = window.prompt('Nombre del nuevo oficio (ej: Carpintería)')
    if (!name) return
    const fd = new FormData()
    fd.set('name', name)
    run(() => createTradeWithList(fd), 'Oficio creado con su lista maestra.')
  }

  function renameTrade(trade: Trade) {
    const name = window.prompt('Nuevo nombre del oficio', trade.name)
    if (!name) return
    const fd = new FormData()
    fd.set('name', name)
    fd.set('slug', trade.slug)
    run(() => updateTrade(trade.id, fd), 'Oficio renombrado.')
  }

  function toggleActive(trade: Trade) {
    const action = trade.is_active ? 'desactivar' : 'reactivar'
    if (!window.confirm(`¿${action} "${trade.name}"? ${trade.is_active ? 'Dejará de ofrecerse a usuarios nuevos (el historial de precios no se toca).' : ''}`)) return
    run(() => setTradeActive(trade.id, !trade.is_active), trade.is_active ? 'Oficio desactivado.' : 'Oficio reactivado.')
  }

  return (
    <div className="mx-auto max-w-[1100px] p-5 pb-28 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--oc-muted)]">Administración</p>
          <h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Catálogo y precios por UT</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-3 py-2 text-right">
            <p className="text-[10px] font-semibold uppercase text-[var(--oc-muted)]">Valor UT maestro vigente</p>
            <p className="text-sm font-bold text-[var(--oc-brand)]">{masterUtValue ? `$${masterUtValue.toLocaleString('es-AR')}` : 'Sin definir'}</p>
          </div>
          <button onClick={changeMasterUt} className="rounded-lg border border-[var(--oc-border)] px-3 py-2 text-xs font-bold">Cambiar</button>
          <button onClick={addTrade} className="rounded-lg bg-[var(--oc-brand)] px-3 py-2 text-xs font-bold text-white">+ Nuevo oficio</button>
        </div>
      </div>

      {notice && (
        <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${notice.kind === 'error' ? 'bg-[var(--oc-danger-bg)] text-[var(--oc-coral)]' : 'bg-[var(--oc-success-bg)] text-[var(--oc-success-text)]'}`}>{notice.text}</p>
      )}

      {trades.map((trade) => {
        const tradeCategories = categories.filter((c) => c.trade_id === trade.id)
        const tradeServices = services.filter((s) => tradeCategories.some((c) => c.id === s.category_id))
        const tradeVersions = versions.filter((v) => v.price_lists?.trade_id === trade.id)
        const priceList = priceLists.find((p) => p.trade_id === trade.id)

        return (
          <section key={trade.id} className="mt-6 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[var(--oc-ink)]">{trade.name} {!trade.is_active && <span className="ml-2 rounded-full bg-[var(--oc-danger-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--oc-coral)]">Inactivo</span>}</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => renameTrade(trade)} className="text-xs font-bold text-[var(--oc-brand)]">Renombrar</button>
                <button onClick={() => toggleActive(trade)} className="text-xs font-bold text-[var(--oc-coral)]">{trade.is_active ? 'Desactivar' : 'Reactivar'}</button>
                {<button onClick={() => addService(tradeCategories[0]?.id ?? null, trade.id)} className="rounded-lg border border-[var(--oc-border)] px-3 py-1.5 text-xs font-bold">+ Trabajo</button>}
              </div>
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
                      <button onClick={() => { if (window.confirm(`¿Borrar "${s.name}"?`)) run(() => deleteService(s.id), 'Trabajo borrado.') }} className="text-xs font-bold text-[var(--oc-coral)]">Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3">
              <BulkLoadPanel tradeId={trade.id} tradeName={trade.name} />
            </div>

            <VersionsSection priceListId={priceList?.id ?? null} versions={tradeVersions} masterUtValue={masterUtValue} tradeName={trade.name} />
          </section>
        )
      })}
    </div>
  )
}

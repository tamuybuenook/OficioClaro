'use client'

import { useState, useTransition } from 'react'
import { createIpcIndex, applyIpcToAllPriceLists } from '@/lib/actions/ipc'
import { CalendarDays, Upload } from 'lucide-react'

type Ipc = { id: string; year: number; month: number; value: number; published_date: string; status: string }
type Sample = { name: string; basePrice: number } | null

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Misma regla que lib/services/ipc.ts (publicación -> mes siguiente), duplicada acá
// porque este componente corre en el cliente y ese módulo no es client-safe.
function nextMonthLabel(publishedDate: string) {
  if (!publishedDate) return null
  const [y, m] = publishedDate.split('-').map(Number)
  if (!y || !m) return null
  const d = new Date(Date.UTC(y, m - 1, 1))
  d.setUTCMonth(d.getUTCMonth() + 1)
  const month = MESES[d.getUTCMonth()]
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getUTCFullYear()}`
}

function money(v: number) {
  return `$${Math.round(v).toLocaleString('es-AR')}`
}

export function IpcPanel({ ipcs, appliedLabel, sample }: { ipcs: Ipc[]; appliedLabel: string | null; sample: Sample }) {
  const [pending, startTransition] = useTransition()
  const [percent, setPercent] = useState('')
  const [monthValue, setMonthValue] = useState('')
  const [published, setPublished] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const last = ipcs[0]
  const pendingIpc = ipcs.find((i) => i.status !== 'applied')
  const willApplyTo = nextMonthLabel(published)
  const previewValue = Number(percent || last?.value || 0)

  function reset() {
    setPercent(''); setMonthValue(''); setPublished(''); setMessage(null)
  }

  function handleCreate() {
    if (!percent || !monthValue || !published) { setMessage('Completá todos los campos.'); return }
    const [year, month] = monthValue.split('-')
    const fd = new FormData()
    fd.set('year', year)
    fd.set('month', String(Number(month)))
    fd.set('value', percent)
    fd.set('published_date', published)
    startTransition(async () => {
      const res = await createIpcIndex(fd)
      if (res && 'error' in res) { setMessage(res.error); return }
      setMessage('IPC guardado.')
      reset()
    })
  }

  function apply(id: string) {
    if (!window.confirm('Esto genera una versión borrador por oficio con el % aplicado. ¿Confirmás?')) return
    startTransition(async () => {
      const res = await applyIpcToAllPriceLists(id)
      setMessage('error' in res ? res.error : 'IPC aplicado: nuevas versiones generadas en borrador.')
    })
  }

  function exportCsv() {
    const rows = [['IPC %', 'Período', 'Publicado', 'Estado'], ...ipcs.map((i) => [String(i.value), `${i.month}/${i.year}`, i.published_date, i.status])]
    const csv = rows.map((r) => r.join(';')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'historial-ipc.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const hasDraft = percent && monthValue && published

  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
          <p className="text-xs font-semibold text-[var(--oc-muted)]">Último IPC cargado</p>
          {last ? (
            <>
              <p className="mt-2 text-3xl font-bold text-[var(--oc-brand)]">{last.value}%</p>
              <p className="mt-3 text-sm text-[var(--oc-muted)]">Publicado <strong className="text-[var(--oc-ink)]">{last.published_date}</strong></p>
              {appliedLabel && <p className="mt-1 text-sm text-[var(--oc-muted)]">Aplicado a <strong className="text-[var(--oc-ink)]">Lista Maestra {appliedLabel}</strong></p>}
            </>
          ) : <p className="mt-2 text-sm text-[var(--oc-muted)]">Todavía no cargaste ningún IPC.</p>}
        </div>
        <div className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
          <p className="text-xs font-semibold text-[var(--oc-muted)]">Próxima actualización</p>
          {pendingIpc ? (
            <>
              <p className="mt-2 text-xl font-bold text-[var(--oc-ink)]">{pendingIpc.value}% pendiente</p>
              <p className="mt-2 text-sm text-[var(--oc-muted)]">Confirmá "Aplicar" en el historial para generarla.</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xl font-bold text-[var(--oc-ink)]">Pendiente</p>
              <p className="mt-2 text-sm text-[var(--oc-muted)]">Se generará cuando cargues y confirmes un IPC.</p>
            </>
          )}
        </div>
      </div>

      <section className="mt-5 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-[var(--oc-brand-soft)] p-3 text-[var(--oc-brand)]"><CalendarDays className="size-5" /></div>
          <div>
            <h2 className="font-bold text-[var(--oc-ink)]">Cargar nuevo IPC</h2>
            <p className="text-sm text-[var(--oc-muted)]">El mes de aplicación se calcula automáticamente.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-semibold text-[var(--oc-ink)]">IPC publicado<input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" placeholder="4,2" className="mt-2 w-full rounded-xl border border-[var(--oc-border)] bg-transparent px-3 py-3 font-normal text-[var(--oc-ink)] outline-none" /></label>
          <label className="text-sm font-semibold text-[var(--oc-ink)]">Mes del IPC<input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} className="mt-2 w-full rounded-xl border border-[var(--oc-border)] bg-transparent px-3 py-3 font-normal text-[var(--oc-ink)] outline-none" /></label>
          <label className="text-sm font-semibold text-[var(--oc-ink)]">Fecha de publicación<input type="date" value={published} onChange={(e) => setPublished(e.target.value)} className="mt-2 w-full rounded-xl border border-[var(--oc-border)] bg-transparent px-3 py-3 font-normal text-[var(--oc-ink)] outline-none" /></label>
        </div>

        {willApplyTo && (
          <div className="mt-5 rounded-xl bg-[var(--oc-brand-soft)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--oc-brand)]">Se aplicará a</p>
            <p className="mt-1 text-lg font-bold text-[var(--oc-brand)]">Lista Maestra {willApplyTo}</p>
          </div>
        )}

        {hasDraft && (
          <div className="mt-5 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface-muted)] p-4">
            <p className="text-xs font-semibold text-[var(--oc-muted)]">Actualización programada</p>
            <p className="mt-2 text-sm text-[var(--oc-ink)]"><strong>IPC:</strong> {percent}% · <strong>Período:</strong> {monthValue} · <strong>Publicado:</strong> {published}</p>
            <p className="mt-3 text-xs text-[var(--oc-muted)]">Este IPC se utilizará como referencia para generar la actualización de precios de la Lista Maestra correspondiente al mes de aplicación.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={reset} className="rounded-xl border border-[var(--oc-border)] px-4 py-2.5 text-sm font-bold text-[var(--oc-ink)]">Cancelar</button>
              <button disabled={pending} onClick={handleCreate} className="rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">Guardar IPC</button>
            </div>
          </div>
        )}
        {message && <p className="mt-3 text-sm font-semibold text-[var(--oc-ink)]">{message}</p>}
      </section>

      <section className="mt-5 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-[var(--oc-ink)]">Historial de IPC</h2>
            <p className="mt-1 text-sm text-[var(--oc-muted)]">Las listas anteriores permanecen intactas.</p>
          </div>
          <button onClick={exportCsv} disabled={ipcs.length === 0} className="flex items-center gap-2 rounded-xl border border-[var(--oc-border)] px-3 py-2 text-xs font-bold text-[var(--oc-ink)] disabled:opacity-50"><Upload className="size-4" />Exportar</button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead><tr className="border-b border-[var(--oc-border-soft)] text-xs text-[var(--oc-muted)]"><th className="px-3 py-3">IPC</th><th>Período</th><th>Publicado</th><th>Aplicación</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {ipcs.map((row) => (
                <tr key={row.id} className="border-b border-[var(--oc-border-soft)] last:border-0">
                  <td className="px-3 py-4 font-bold text-[var(--oc-brand)]">{row.value}%</td>
                  <td className="text-[var(--oc-ink)]">{MESES[row.month - 1]?.replace(/^./, (c) => c.toUpperCase())} {row.year}</td>
                  <td className="text-[var(--oc-muted)]">{row.published_date}</td>
                  <td className="text-[var(--oc-ink)]">{nextMonthLabel(row.published_date)}</td>
                  <td>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${row.status === 'applied' ? 'bg-[var(--oc-success-bg)] text-[var(--oc-success-text)]' : 'bg-[var(--oc-blue-bg)] text-[var(--oc-blue-text)]'}`}>{row.status === 'applied' ? 'Aplicado' : 'Programado'}</span>
                  </td>
                  <td>{row.status !== 'applied' && <button disabled={pending} onClick={() => apply(row.id)} className="text-xs font-bold text-[var(--oc-brand)]">Aplicar</button>}</td>
                </tr>
              ))}
              {ipcs.length === 0 && <tr><td colSpan={6} className="p-4 text-sm text-[var(--oc-muted)]">Sin registros todavía.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {sample && (
        <section className="mt-5 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
          <h2 className="font-bold text-[var(--oc-ink)]">Previsualizar actualización</h2>
          <p className="mt-1 text-sm text-[var(--oc-muted)]">Ejemplo real: "{sample.name}". Vista previa: no modifica ninguna lista hasta que la confirmes arriba.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div><p className="text-xs text-[var(--oc-muted)]">Precio actual</p><p className="mt-1 font-bold text-[var(--oc-ink)]">{money(sample.basePrice)}</p></div>
            <div><p className="text-xs text-[var(--oc-muted)]">IPC aplicado</p><p className="mt-1 font-bold text-[var(--oc-brand)]">{previewValue || 0}%</p></div>
            <div><p className="text-xs text-[var(--oc-muted)]">Nuevo precio</p><p className="mt-1 font-bold text-[var(--oc-ink)]">{money(sample.basePrice * (1 + previewValue / 100))}</p></div>
            <div><p className="text-xs text-[var(--oc-muted)]">Diferencia</p><p className="mt-1 font-bold text-[var(--oc-success-text)]">+{money(sample.basePrice * (previewValue / 100))}</p></div>
          </div>
        </section>
      )}
    </div>
  )
}

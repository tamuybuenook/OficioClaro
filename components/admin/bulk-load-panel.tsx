'use client'

import { useState, useTransition } from 'react'
import { bulkUpsertCatalog } from '@/lib/actions/catalog'

type Row = { category: string; name: string; ut: number }
type ParsedRow = Row | { error: string; raw: string }

function parseLine(line: string): ParsedRow {
  const parts = line.split(';').map((p) => p.trim())
  if (parts.length !== 3) return { error: 'Formato esperado: Categoría;Trabajo;UT', raw: line }
  const [category, name, utRaw] = parts
  const ut = Number(utRaw.replace(',', '.'))
  if (!category || !name) return { error: 'Faltan datos', raw: line }
  if (!ut || ut <= 0) return { error: 'UT inválida', raw: line }
  return { category, name, ut }
}

export function BulkLoadPanel({ tradeId, tradeName }: { tradeId: string; tradeName: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)

  const validRows = (rows ?? []).filter((r): r is Row => !('error' in r))
  const hasErrors = (rows ?? []).some((r) => 'error' in r)

  function preview() {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    setRows(lines.map(parseLine))
    setResult(null)
  }

  function confirm() {
    if (!validRows.length) return
    startTransition(async () => {
      const res = await bulkUpsertCatalog(tradeId, validRows)
      if ('error' in res) { setResult(`Error: ${res.error}`); return }
      setResult(`Listo: ${res.data.created} creados, ${res.data.updated} actualizados.`)
      setRows(null)
      setText('')
    })
  }

  if (!open) return <button onClick={() => setOpen(true)} className="text-xs font-bold text-[var(--oc-brand)]">Cargar lista completa</button>

  return (
    <div className="rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4">
      <p className="text-sm font-bold text-[var(--oc-ink)]">Cargar lista de {tradeName}</p>
      <p className="mt-1 text-xs text-[var(--oc-muted)]">Una línea por trabajo: Categoría;Trabajo;UT</p>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setRows(null) }}
        placeholder={'Grifería;Cambio de canilla;2.5\nGrifería;Instalación de canilla;3'}
        rows={6}
        className="mt-3 w-full rounded-lg border border-[var(--oc-border)] bg-transparent p-3 font-mono text-xs text-[var(--oc-ink)] outline-none"
      />
      <div className="mt-2 flex gap-2">
        <button onClick={preview} className="rounded-lg border border-[var(--oc-border)] px-3 py-2 text-xs font-bold">Vista previa</button>
        {rows && <button disabled={pending || !validRows.length} onClick={confirm} className="rounded-lg bg-[var(--oc-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">Confirmar carga ({validRows.length})</button>}
        <button onClick={() => { setOpen(false); setRows(null); setText(''); setResult(null) }} className="ml-auto text-xs font-bold text-[var(--oc-muted)]">Cerrar</button>
      </div>

      {rows && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-[var(--oc-border-soft)]">
          <table className="w-full text-left text-xs">
            <tbody>
              {rows.map((r, i) => 'error' in r ? (
                <tr key={i} className="border-t border-[var(--oc-border-soft)] bg-[#fdecea]"><td className="p-2 text-[var(--oc-coral)]" colSpan={3}>{r.error}: "{r.raw}"</td></tr>
              ) : (
                <tr key={i} className="border-t border-[var(--oc-border-soft)]"><td className="p-2">{r.category}</td><td className="p-2">{r.name}</td><td className="p-2 font-bold">{r.ut}</td></tr>
              ))}
            </tbody>
          </table>
          {hasErrors && <p className="p-2 text-xs text-[var(--oc-coral)]">Corregí las líneas con error; solo se cargan las válidas.</p>}
        </div>
      )}
      {result && <p className="mt-2 text-xs font-semibold text-[var(--oc-ink)]">{result}</p>}
    </div>
  )
}

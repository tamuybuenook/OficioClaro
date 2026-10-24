'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Trash2, Undo2 } from 'lucide-react'
import { saveQuote } from '@/lib/actions/quoteBuilder'
import { invalidate } from '@/lib/cache/store'
import { deleteLocalDraft, draftKey, loadLocalDraft, saveLocalDraft, type LocalQuoteDraft } from '@/lib/cache/drafts'
import {
  MAX_DESCRIPTION, MAX_NOTES, hasErrors, lineSubtotal, parseDecimal, quoteNumberLabel, quoteTotal, validateQuote,
  type Concept, type CustomerOption, type LineErrors, type QuoteLine, type QuoteForEdit,
} from '@/lib/quotes'
import { ConceptFinder, type CustomConcept } from './concept-finder'
import { CustomerPicker } from './customer-picker'
import { card, errText, field, fieldLabel, ghostBtn, money, newId, primaryBtn, timeAgo } from './ui'

// UN SOLO formulario de presupuesto: lo usan "Presupuestar" (Clientes), el trabajo de la Agenda y la lista de Presupuestos.
// Mismas reglas, mismos cálculos, mismo guardado (save_quote en la base).

export type EditorInitial = {
  quote: QuoteForEdit | null            // null = presupuesto nuevo
  customer: CustomerOption | null       // cliente precargado (desde Clientes o desde el trabajo)
  jobId: string | null                  // trabajo de la agenda al que se vincula
  jobLabel: string | null
  lockCustomer: boolean                 // el cliente ya viene fijado por el trabajo
}

const fmt = (n: number) => (Number.isFinite(n) ? String(n).replace('.', ',') : '')
const sameLines = (a: QuoteLine[], b: QuoteLine[]) =>
  a.length === b.length && a.every((l, i) => l.description === b[i].description && l.quantity === b[i].quantity && l.unitPrice === b[i].unitPrice && l.serviceId === b[i].serviceId && l.catalogItemId === b[i].catalogItemId)

export function QuoteEditor({ initial, onClose, onSaved, onBackToAgenda }: {
  initial: EditorInitial
  onClose: () => void
  onSaved: (quoteId: string) => void
  onBackToAgenda?: (jobId: string) => void
}) {
  const startQuote = initial.quote
  const [quoteId, setQuoteId] = useState<string | null>(startQuote?.id ?? null)
  const [customer, setCustomer] = useState<CustomerOption | null>(startQuote?.customer ?? initial.customer)
  const [lines, setLines] = useState<QuoteLine[]>(startQuote?.lines ?? [])
  const [notes, setNotes] = useState(startQuote?.notes ?? '')
  const [errors, setErrors] = useState<{ form?: string; lines: Record<string, LineErrors> }>({ lines: {} })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ number: number; total: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [offer, setOffer] = useState<LocalQuoteDraft | null>(null)
  const [undo, setUndo] = useState<{ line: QuoteLine; index: number } | null>(null)
  const [announce, setAnnounce] = useState('')
  const [dirty, setDirty] = useState(false)
  const requestId = useRef(newId())      // misma clave en cada reintento: un reintento nunca duplica el presupuesto
  const submitting = useRef(false)       // frena el doble clic antes de que React refleje `saving`
  const jobId = initial.jobId

  const key = useMemo(() => draftKey({ quoteId, customerId: initial.customer?.id ?? null, jobId }), [quoteId, initial.customer?.id, jobId])
  const total = quoteTotal(lines)
  const customerLocked = initial.lockCustomer || !!startQuote?.job

  // ---- recuperar un borrador guardado en este dispositivo (después de recargar o perder la conexión)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const d = await loadLocalDraft(key)
      if (!alive || !d) return
      const same = startQuote ? sameLines(d.lines, startQuote.lines) && d.notes === (startQuote.notes ?? '') : false
      if (same) { await deleteLocalDraft(key); return }
      setOffer(d)
    })()
    return () => { alive = false }
    // solo al abrir el formulario
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- autoguardado local (solo si el usuario tocó algo)
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => {
      void saveLocalDraft(key, {
        requestId: requestId.current, quoteId, customer, jobId, notes,
        lines: lines.map((l) => ({ ...l, quantity: Number.isFinite(l.quantity) ? l.quantity : 0, unitPrice: Number.isFinite(l.unitPrice) ? l.unitPrice : 0 })),
        editedAt: Date.now(),
      })
    }, 600)
    return () => clearTimeout(t)
  }, [dirty, key, quoteId, customer, jobId, notes, lines])

  function restore(d: LocalQuoteDraft) {
    if (!customerLocked) setCustomer(d.customer)
    setLines(d.lines); setNotes(d.notes)
    requestId.current = d.requestId
    setOffer(null); setDirty(true); setSaved(null)
  }
  async function discard() { await deleteLocalDraft(key); setOffer(null) }

  const touch = useCallback(() => { setDirty(true); setSaved(null) }, [])

  // ---- líneas
  function addConcept(c: Concept) {
    touch()
    setLines((prev) => {
      const same = prev.find((l) => (c.kind === 'service' ? l.serviceId === c.id : l.catalogItemId === c.id))
      if (same) return prev.map((l) => (l === same ? { ...l, quantity: Number.isFinite(l.quantity) ? l.quantity + 1 : 1 } : l))
      return [...prev, { key: newId(), source: c.kind === 'service' ? 'service' : 'own', serviceId: c.kind === 'service' ? c.id : null, catalogItemId: c.kind === 'own' ? c.id : null, description: c.name, unitLabel: c.unit, quantity: 1, unitPrice: c.price }]
    })
    setAnnounce(`Agregado: ${c.name}`)
  }
  function addCustom(c: CustomConcept) {
    touch()
    setLines((prev) => [...prev, { key: newId(), source: c.catalogItemId ? 'own' : 'custom', serviceId: null, catalogItemId: c.catalogItemId, description: c.description, unitLabel: c.unit, quantity: 1, unitPrice: c.price }])
    setAnnounce(`Agregado: ${c.description}`)
  }
  const patchLine = (k: string, patch: Partial<QuoteLine>) => { touch(); setLines((prev) => prev.map((l) => (l.key === k ? { ...l, ...patch } : l))) }
  function removeLine(k: string) {
    touch()
    setLines((prev) => {
      const index = prev.findIndex((l) => l.key === k)
      if (index < 0) return prev
      setUndo({ line: prev[index], index })
      return prev.filter((l) => l.key !== k)
    })
  }
  function undoRemove() {
    if (!undo) return
    setLines((prev) => { const next = [...prev]; next.splice(Math.min(undo.index, next.length), 0, undo.line); return next })
    setUndo(null)
  }

  // ---- guardar
  async function save(thenView: boolean) {
    if (submitting.current) return
    const check = validateQuote(lines, notes)
    if (hasErrors(check)) {
      setErrors({ form: check.form ?? 'Revisá las líneas marcadas.', lines: check.lines })
      const first = Object.keys(check.lines)[0]
      if (first) document.getElementById(`line-${first}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      return
    }
    setErrors({ lines: {} }); setNotice(null)
    submitting.current = true; setSaving(true)
    try {
      const res = await saveQuote({ requestId: requestId.current, quoteId, customerId: customer?.id ?? null, notes, lines, jobId })
      if (res.error || !res.data) { setErrors({ form: res.error ?? 'No se pudo guardar.', lines: res.fieldErrors ?? {} }); return }
      const { id, number, total: serverTotal, linkError } = res.data
      await deleteLocalDraft(key)
      await invalidate('quotes:')
      setQuoteId(id); setDirty(false); setSaved({ number, total: serverTotal })
      if (linkError) setNotice(`El presupuesto se guardó, pero no se pudo vincular al trabajo: ${linkError}`)
      if (thenView && !linkError) onSaved(id)
    } catch {
      setErrors({ form: 'No se pudo guardar. Revisá tu conexión e intentá de nuevo: tu trabajo quedó guardado en este dispositivo y al reintentar no se duplica.', lines: {} })
    } finally {
      submitting.current = false; setSaving(false)
    }
  }

  const title = quoteId ? `Presupuesto ${quoteNumberLabel(saved?.number ?? startQuote?.number)}` : 'Nuevo presupuesto'

  return (
    <div className="mx-auto max-w-[860px] p-5 pb-28 md:p-8" aria-busy={saving}>
      <button type="button" onClick={onClose} className="mb-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--oc-brand)]"><ArrowLeft className="size-4" aria-hidden="true" />Volver</button>
      <h1 className="text-2xl font-bold text-[var(--oc-ink)]">{title}</h1>
      <p className="mt-1 text-sm text-[var(--oc-muted)]">Borrador{jobId && initial.jobLabel ? ` · para el trabajo “${initial.jobLabel}”` : ''}. Todo lo que cargues se conserva mientras buscás y agregás.</p>
      {jobId && onBackToAgenda && <button type="button" onClick={() => onBackToAgenda(jobId)} className="mt-1 min-h-11 text-sm font-bold text-[var(--oc-brand)] underline">Volver al trabajo en la agenda</button>}

      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {offer && (
        <div role="status" className="mt-4 rounded-xl bg-[var(--oc-warm-bg)] p-4 text-[var(--oc-warm-text)]">
          <p className="text-sm font-bold">Encontramos cambios sin guardar de este dispositivo ({timeAgo(offer.editedAt)}).</p>
          <p className="mt-0.5 text-xs">{offer.lines.length} línea{offer.lines.length === 1 ? '' : 's'}{offer.customer ? ` · ${offer.customer.name}` : ''}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => restore(offer)} className={primaryBtn}>Restaurar</button>
            <button type="button" onClick={discard} className={ghostBtn}>Descartar</button>
          </div>
        </div>
      )}

      <section className={`mt-5 ${card}`} aria-labelledby="q-customer">
        <h2 id="q-customer" className="mb-3 text-base font-bold text-[var(--oc-ink)]">Cliente</h2>
        <CustomerPicker value={customer} onChange={(c) => { touch(); setCustomer(c) }} disabled={customerLocked}
          lockedReason={customerLocked ? (startQuote?.job ? 'Este presupuesto ya tiene un trabajo en la agenda: el cliente no se puede cambiar.' : 'El cliente es el del trabajo.') : null} />
        {!customer && <p className="mt-2 text-xs text-[var(--oc-muted)]">Podés guardar sin cliente y asignarlo después.</p>}
      </section>

      <section className={`mt-4 ${card}`} aria-labelledby="q-add">
        <h2 id="q-add" className="mb-3 text-base font-bold text-[var(--oc-ink)]">Agregar trabajos o artículos</h2>
        <ConceptFinder onAdd={addConcept} onAddCustom={addCustom} />
      </section>

      <section className={`mt-4 ${card}`} aria-labelledby="q-lines">
        <h2 id="q-lines" className="text-base font-bold text-[var(--oc-ink)]">Detalle del presupuesto</h2>
        <p className="mt-1 text-xs text-[var(--oc-muted)]">Podés cambiar descripción, cantidad y precio de cada línea: solo afecta a este presupuesto, no a tu catálogo.</p>
        {undo && (
          <div role="status" className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[var(--oc-surface-soft)] px-3 py-2 text-sm">
            <span className="min-w-0 truncate">Quitaste “{undo.line.description}”.</span>
            <button type="button" onClick={undoRemove} className="flex min-h-11 shrink-0 items-center gap-1 font-bold text-[var(--oc-brand)]"><Undo2 className="size-4" aria-hidden="true" />Deshacer</button>
          </div>
        )}
        {lines.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--oc-border)] p-4 text-sm text-[var(--oc-muted)]">Todavía no agregaste nada. Buscá arriba un trabajo o artículo, o creá uno nuevo.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {lines.map((l) => <LineRow key={l.key} line={l} errors={errors.lines[l.key]} onChange={(p) => patchLine(l.key, p)} onRemove={() => removeLine(l.key)} />)}
          </ul>
        )}
        <div className="mt-4 flex items-center justify-between border-t border-[var(--oc-border-soft)] pt-4">
          <p className="font-bold text-[var(--oc-ink)]">Total</p>
          <p className="text-xl font-bold text-[var(--oc-brand)]" data-testid="quote-total">{money(total)}</p>
        </div>
      </section>

      <section className={`mt-4 ${card}`}>
        <label className={fieldLabel}>Observaciones (opcional)
          <textarea value={notes} onChange={(e) => { touch(); setNotes(e.target.value) }} rows={3} maxLength={MAX_NOTES} className={`${field} resize-y`} placeholder="Condiciones, plazos, materiales a cargo del cliente…" />
        </label>
      </section>

      {errors.form && <p role="alert" className="mt-4 rounded-xl bg-[var(--oc-danger-bg)] px-4 py-3 text-sm font-semibold text-[var(--oc-coral)]">{errors.form}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-[var(--oc-warm-bg)] px-4 py-3 text-sm font-semibold text-[var(--oc-warm-text)]">{notice}</p>}
      {saved && !errors.form && <p role="status" className="mt-4 rounded-xl bg-[var(--oc-success-bg,var(--oc-brand-soft))] px-4 py-3 text-sm font-semibold text-[var(--oc-success-text,var(--oc-brand))]">Guardado: presupuesto {quoteNumberLabel(saved.number)} · total {money(saved.total)}.</p>}

      {/* Barra fija: los botones quedan siempre a la vista, por encima de la barra inferior del celular */}
      <div className="sticky bottom-[4.5rem] z-20 -mx-5 mt-5 flex flex-col-reverse gap-3 border-t border-[var(--oc-border)] bg-[var(--oc-page)] px-5 py-3 sm:flex-row sm:justify-end md:bottom-0 md:mx-0 md:px-0">
        <button type="button" onClick={() => save(false)} disabled={saving} className={ghostBtn}>{saving ? 'Guardando…' : 'Guardar borrador'}</button>
        <button type="button" onClick={() => save(true)} disabled={saving || lines.length === 0} className={primaryBtn}>{saving ? 'Guardando…' : 'Guardar y ver presupuesto'}</button>
      </div>
    </div>
  )
}

function LineRow({ line, errors, onChange, onRemove }: { line: QuoteLine; errors?: LineErrors; onChange: (p: Partial<QuoteLine>) => void; onRemove: () => void }) {
  const [qty, setQty] = useState(fmt(line.quantity))
  const [price, setPrice] = useState(fmt(line.unitPrice))
  // si la cantidad cambia desde afuera (p. ej. se agregó el mismo concepto otra vez), se refleja en el campo
  useEffect(() => { if (Number.isFinite(line.quantity) && parseDecimal(qty) !== line.quantity) setQty(fmt(line.quantity)) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [line.quantity])
  useEffect(() => { if (Number.isFinite(line.unitPrice) && parseDecimal(price) !== line.unitPrice) setPrice(fmt(line.unitPrice)) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [line.unitPrice])

  const sub = Number.isFinite(line.quantity) && Number.isFinite(line.unitPrice) ? lineSubtotal(line.quantity, line.unitPrice) : null
  const origin = line.source === 'service' ? 'Lista de precios' : line.source === 'own' ? 'Mi catálogo' : 'Concepto libre'
  const id = line.key

  return (
    <li id={`line-${id}`} className="rounded-xl border border-[var(--oc-border)] p-3">
      <div className="flex items-start gap-2">
        <label className={`${fieldLabel} flex-1`}>
          <span className="flex items-center justify-between gap-2"><span>Descripción</span><span className="text-xs font-normal">{origin}</span></span>
          <input value={line.description} onChange={(e) => onChange({ description: e.target.value })} maxLength={MAX_DESCRIPTION} className={field} aria-invalid={!!errors?.description} aria-describedby={errors?.description ? `${id}-d` : undefined} />
          {errors?.description && <span id={`${id}-d`} role="alert" className={errText}>{errors.description}</span>}
        </label>
        <button type="button" onClick={onRemove} aria-label={`Quitar ${line.description || 'la línea'}`} className="mt-7 flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--oc-border)] text-[var(--oc-coral)]"><Trash2 className="size-4" aria-hidden="true" /></button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className={fieldLabel}>Cantidad{line.unitLabel ? ` (${line.unitLabel})` : ''}
          <input value={qty} inputMode="decimal" onChange={(e) => { setQty(e.target.value); onChange({ quantity: parseDecimal(e.target.value) }) }} className={field} aria-invalid={!!errors?.quantity} aria-describedby={errors?.quantity ? `${id}-q` : undefined} />
          {errors?.quantity && <span id={`${id}-q`} role="alert" className={errText}>{errors.quantity}</span>}
        </label>
        <label className={fieldLabel}>Precio unitario
          <input value={price} inputMode="decimal" onChange={(e) => { setPrice(e.target.value); onChange({ unitPrice: parseDecimal(e.target.value) }) }} className={field} aria-invalid={!!errors?.unitPrice} aria-describedby={errors?.unitPrice ? `${id}-p` : undefined} />
          {errors?.unitPrice && <span id={`${id}-p`} role="alert" className={errText}>{errors.unitPrice}</span>}
        </label>
        <div className="col-span-2 flex flex-col justify-end sm:col-span-1">
          <p className="text-xs text-[var(--oc-muted)]">Subtotal</p>
          <p className="text-lg font-bold text-[var(--oc-brand)]" data-testid={`subtotal-${id}`}>{sub === null ? '—' : money(sub)}</p>
        </div>
      </div>
    </li>
  )
}

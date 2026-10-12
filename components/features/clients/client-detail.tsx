'use client'

import { useEffect, useState, useTransition } from 'react'
import { fetchClientDetail, addClientJob, addClientNote, setClientRating } from '@/lib/actions/clientDetail'
import { ArrowLeft, Star } from 'lucide-react'

type Tab = 'datos' | 'trabajos' | 'presupuestos' | 'actividad' | 'notas' | 'valoracion'
const TABS: { id: Tab; label: string }[] = [
  { id: 'datos', label: 'Datos' },
  { id: 'trabajos', label: 'Trabajos' },
  { id: 'presupuestos', label: 'Presupuestos' },
  { id: 'actividad', label: 'Actividad' },
  { id: 'notas', label: 'Notas' },
  { id: 'valoracion', label: 'Valoración' },
]

const activityLabel: Record<string, string> = {
  trabajo_realizado: 'Trabajo realizado',
  presupuesto_creado: 'Presupuesto creado',
  presupuesto_enviado: 'Presupuesto enviado',
  presupuesto_aceptado: 'Presupuesto aceptado',
  presupuesto_rechazado: 'Presupuesto rechazado',
}
const statusLabel: Record<string, string> = { draft: 'Borrador', sent: 'Enviado', accepted: 'Aceptado', rejected: 'Rechazado' }

export function ClientDetail({ customerId, onBack }: { customerId: string; onBack: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchClientDetail>> | null>(null)
  const [tab, setTab] = useState<Tab>('datos')
  const [pending, startTransition] = useTransition()

  async function reload() { setData(await fetchClientDetail(customerId)) }
  useEffect(() => { reload() }, [customerId])

  if (!data || !data.customer) return <div className="mx-auto max-w-[1040px] p-5">Cargando…</div>
  const c = data.customer

  function addJob() {
    const description = window.prompt('Trabajo realizado')
    if (!description) return
    const price = window.prompt('Precio (opcional)')
    const fd = new FormData()
    fd.set('description', description)
    if (price) fd.set('price', price)
    startTransition(async () => { await addClientJob(customerId, fd); reload() })
  }

  function addNote() {
    const note = window.prompt('Nota interna (no se comparte con el cliente)')
    if (!note) return
    startTransition(async () => { await addClientNote(customerId, note); reload() })
  }

  function rate(stars: number) {
    const note = window.prompt('Nota interna sobre esta valoración (opcional)', c.rating_note ?? '') ?? c.rating_note
    startTransition(async () => { await setClientRating(customerId, stars, note || null); reload() })
  }

  return (
    <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8">
      <button onClick={onBack} className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--oc-brand)]"><ArrowLeft className="size-4" />Volver a clientes</button>
      <h1 className="text-2xl font-bold text-[var(--oc-ink)]">{c.name}</h1>
      <p className="mt-1 text-sm text-[var(--oc-muted)]">{[c.phone, c.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</p>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold ${tab === t.id ? 'bg-[var(--oc-brand)] text-white' : 'border border-[var(--oc-border)] text-[var(--oc-muted)]'}`}>{t.label}</button>)}
      </div>

      <div className="mt-5 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
        {tab === 'datos' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs text-[var(--oc-muted)]">Teléfono</p><p className="font-semibold">{c.phone ?? '—'}</p></div>
            <div><p className="text-xs text-[var(--oc-muted)]">Email</p><p className="font-semibold">{c.email ?? '—'}</p></div>
            <div className="sm:col-span-2"><p className="text-xs text-[var(--oc-muted)]">Dirección</p><p className="font-semibold">{c.address ?? '—'}</p></div>
            <div className="sm:col-span-2"><p className="text-xs text-[var(--oc-muted)]">Observaciones</p><p className="font-semibold">{c.notes ?? '—'}</p></div>
          </div>
        )}

        {tab === 'trabajos' && (
          <div>
            <button onClick={addJob} disabled={pending} className="mb-4 rounded-lg bg-[var(--oc-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">+ Registrar trabajo</button>
            {data.jobs.length === 0 ? <p className="text-sm text-[var(--oc-muted)]">Todavía no hay trabajos registrados.</p> : (
              <div className="flex flex-col divide-y divide-[var(--oc-border-soft)]">
                {data.jobs.map((j: any) => (
                  <div key={j.id} className="py-3">
                    <div className="flex items-center justify-between"><p className="font-semibold">{j.description}</p><p className="text-xs text-[var(--oc-muted)]">{j.job_date}</p></div>
                    <p className="mt-1 text-xs text-[var(--oc-muted)]">{j.trades?.name ?? 'Sin oficio'} {j.price ? `· $${Number(j.price).toLocaleString('es-AR')}` : ''}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'presupuestos' && (
          <div>
            {data.quotes.length === 0 ? <p className="text-sm text-[var(--oc-muted)]">Todavía no tiene presupuestos.</p> : (
              <div className="flex flex-col divide-y divide-[var(--oc-border-soft)]">
                {data.quotes.map((q: any) => (
                  <div key={q.id} className="flex items-center justify-between py-3">
                    <div><p className="font-semibold">Presupuesto Nº {String(q.number ?? '?').padStart(5, '0')}</p><p className="text-xs text-[var(--oc-muted)]">{new Date(q.created_at).toLocaleDateString('es-AR')}</p></div>
                    <div className="text-right"><p className="font-bold text-[var(--oc-brand)]">${Number(q.total).toLocaleString('es-AR')}</p><p className="text-xs text-[var(--oc-muted)]">{statusLabel[q.status] ?? q.status}</p></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'actividad' && (
          <div className="flex flex-col divide-y divide-[var(--oc-border-soft)]">
            {data.activity.length === 0 && <p className="text-sm text-[var(--oc-muted)]">Sin actividad registrada.</p>}
            {data.activity.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between py-2 text-sm"><span>{activityLabel[a.type] ?? a.type}{a.description ? ` · ${a.description}` : ''}</span><span className="text-xs text-[var(--oc-muted)]">{new Date(a.created_at).toLocaleDateString('es-AR')}</span></div>
            ))}
          </div>
        )}

        {tab === 'notas' && (
          <div>
            <button onClick={addNote} disabled={pending} className="mb-4 rounded-lg bg-[var(--oc-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">+ Nueva nota</button>
            <p className="mb-3 text-xs text-[var(--oc-muted)]">Privadas: nunca se comparten con el cliente.</p>
            {data.notes.length === 0 ? <p className="text-sm text-[var(--oc-muted)]">Sin notas todavía.</p> : (
              <div className="flex flex-col divide-y divide-[var(--oc-border-soft)]">
                {data.notes.map((n: any) => <div key={n.id} className="py-2"><p className="text-sm">{n.note}</p><p className="text-xs text-[var(--oc-muted)]">{new Date(n.created_at).toLocaleDateString('es-AR')}</p></div>)}
              </div>
            )}
          </div>
        )}

        {tab === 'valoracion' && (
          <div>
            <p className="text-xs text-[var(--oc-muted)]">Privada: uso exclusivo dentro de OficioClaro, nunca se comparte.</p>
            <div className="mt-3 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => rate(n)} disabled={pending}>
                  <Star className={`size-7 ${c.rating && n <= c.rating ? 'fill-[var(--oc-coral)] text-[var(--oc-coral)]' : 'text-[var(--oc-border)]'}`} />
                </button>
              ))}
            </div>
            {c.rating_note && <p className="mt-3 text-sm text-[var(--oc-muted)]">"{c.rating_note}"</p>}
          </div>
        )}
      </div>
    </div>
  )
}

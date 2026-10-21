'use client'

import { useState } from 'react'

// Pasos aislados en un arreglo para poder enchufarlos al tour global de OficioClaro si se agrega.
export const AGENDA_HELP_STEPS: { title: string; body: string }[] = [
  { title: 'Tus próximos trabajos', body: 'La vista “Agenda” lista lo que viene, día por día. Los que todavía no tienen fecha aparecen aparte, en “Pendientes de coordinar”.' },
  { title: 'Cambiá de día o de semana', body: 'Usá las flechas, “Hoy” o elegí una fecha. En “Semana” tocás un día y ves sus trabajos.' },
  { title: 'Agendá un trabajo', body: 'Tocá “Nuevo trabajo”. También podés hacerlo desde la ficha de un cliente o desde un presupuesto aceptado: el cliente y los datos ya vienen cargados.' },
  { title: 'Reprogramá o cambiá el estado', body: 'En cada trabajo podés editarlo, reprogramarlo, cambiar su estado o cancelarlo. Nada se borra: queda el seguimiento.' },
]

export function AgendaHelp({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  const step = AGENDA_HELP_STEPS[i]
  const last = i === AGENDA_HELP_STEPS.length - 1
  return (
    <section aria-label="Ayuda de la agenda" className="mt-5 rounded-2xl border-2 border-[var(--oc-warm-border)] bg-[var(--oc-warm-card)] p-4 sm:p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--oc-warm-label)]">Cómo funciona · Paso {i + 1} de {AGENDA_HELP_STEPS.length}</p>
      <h2 className="mt-1 text-lg font-bold text-[var(--oc-ink)]">{step.title}</h2>
      <p className="mt-1 text-sm text-[var(--oc-ink)]">{step.body}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setI(i - 1)} disabled={i === 0} className="min-h-11 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-4 py-2 text-sm font-bold text-[var(--oc-brand)] disabled:opacity-40">Anterior</button>
        {last ? (
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-[var(--oc-brand)] px-4 py-2 text-sm font-bold text-white">Entendido</button>
        ) : (
          <button type="button" onClick={() => setI(i + 1)} className="min-h-11 rounded-xl bg-[var(--oc-brand)] px-4 py-2 text-sm font-bold text-white">Siguiente</button>
        )}
        {!last && <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm font-bold text-[var(--oc-muted)] underline">Cerrar ayuda</button>}
      </div>
    </section>
  )
}

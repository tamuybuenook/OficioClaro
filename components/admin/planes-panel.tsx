'use client'

import { useState, useTransition } from 'react'
import { updatePlan } from '@/lib/actions/subscriptions'

type Plan = { id: string; name: string; price: number; billing_period: string; max_trades: number | null; trial_days: number; is_active: boolean }

export function PlanesPanel({ plans }: { plans: Plan[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(planId: string, formData: FormData) {
    startTransition(async () => {
      await updatePlan(planId, formData)
      setEditing(null)
    })
  }

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-3">
      {plans.map((p) => (
        <div key={p.id} className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4">
          {editing === p.id ? (
            <form action={(fd) => save(p.id, fd)} className="flex flex-col gap-2">
              <input name="name" defaultValue={p.name} className="rounded-lg border border-[var(--oc-border)] p-2 text-sm font-bold" />
              <input name="price" type="number" defaultValue={p.price} className="rounded-lg border border-[var(--oc-border)] p-2 text-sm" placeholder="Precio" />
              <select name="billing_period" defaultValue={p.billing_period} className="rounded-lg border border-[var(--oc-border)] p-2 text-sm">
                <option value="monthly">Mensual</option>
                <option value="yearly">Anual</option>
              </select>
              <input name="max_trades" type="number" defaultValue={p.max_trades ?? ''} placeholder="Oficios (vacío = todos)" className="rounded-lg border border-[var(--oc-border)] p-2 text-sm" />
              <input name="trial_days" type="number" defaultValue={p.trial_days} placeholder="Días de prueba" className="rounded-lg border border-[var(--oc-border)] p-2 text-sm" />
              <label className="flex items-center gap-2 text-sm"><input name="is_active" type="checkbox" defaultChecked={p.is_active} />Activo</label>
              <div className="mt-1 flex gap-2">
                <button type="submit" disabled={pending} className="rounded-lg bg-[var(--oc-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">Guardar</button>
                <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-[var(--oc-border)] px-3 py-2 text-xs font-bold">Cancelar</button>
              </div>
            </form>
          ) : (
            <>
              <p className="font-bold">{p.name}</p>
              <p className="mt-1 text-xl font-bold text-[var(--oc-brand)]">${p.price.toLocaleString('es-AR')}/{p.billing_period === 'monthly' ? 'mes' : 'año'}</p>
              <p className="mt-2 text-sm text-[var(--oc-muted)]">{p.max_trades === null ? 'Todos los oficios' : `${p.max_trades} oficio(s)`}</p>
              <p className="mt-1 text-xs text-[var(--oc-muted)]">{p.trial_days} días gratis · {p.is_active ? 'Activo' : 'Inactivo'}</p>
              <button onClick={() => setEditing(p.id)} className="mt-3 text-xs font-bold text-[var(--oc-brand)]">Editar</button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

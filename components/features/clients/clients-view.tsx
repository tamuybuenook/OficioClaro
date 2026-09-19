'use client'

import { useState, useTransition } from 'react'
import { createCustomer, updateCustomer, deleteCustomer } from '@/lib/actions/customers'
import { Trash2, Pencil } from 'lucide-react'

type Customer = { id: string; name: string; phone: string | null; email: string | null; address: string | null }

const fieldClass = 'rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-3 py-3 text-sm text-[var(--oc-ink)] outline-none focus:border-[var(--oc-brand)]'

function ClientForm({ defaultValues, onSubmit, pending, submitLabel }: { defaultValues?: Partial<Customer>; onSubmit: (fd: FormData) => void; pending: boolean; submitLabel: string }) {
  return (
    <form action={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--oc-muted)]">Nombre y apellido<input name="name" defaultValue={defaultValues?.name} required className={fieldClass} /></label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--oc-muted)]">Teléfono<input name="phone" defaultValue={defaultValues?.phone ?? ''} className={fieldClass} /></label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--oc-muted)]">Email<input name="email" type="email" defaultValue={defaultValues?.email ?? ''} className={fieldClass} /></label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--oc-muted)]">Dirección<input name="address" defaultValue={defaultValues?.address ?? ''} className={fieldClass} /></label>
      <button type="submit" disabled={pending} className="sm:col-span-2 mt-1 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{submitLabel}</button>
    </form>
  )
}

export function ClientsUpdated({ customers }: { customers: Customer[] }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleCreate(formData: FormData) {
    startTransition(() => { createCustomer(formData) })
    setShowForm(false)
  }

  function handleUpdate(id: string, formData: FormData) {
    startTransition(() => { updateCustomer(id, formData) })
    setEditingId(null)
  }

  return (
    <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8">
      <div className="flex items-start justify-between">
        <div><p className="text-sm text-[var(--oc-muted)]">Personas a las que les presupuestás</p><h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Mis clientes</h1></div>
        <button onClick={() => setShowForm(!showForm)} className="rounded-xl bg-[var(--oc-coral)] px-4 py-2.5 text-sm font-bold text-white">{showForm ? 'Cerrar' : '+ Nuevo cliente'}</button>
      </div>

      {showForm && (
        <div className="mt-6 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
          <h2 className="font-bold text-[var(--oc-ink)]">Dar de alta un cliente</h2>
          <div className="mt-4"><ClientForm onSubmit={handleCreate} pending={pending} submitLabel="Guardar cliente" /></div>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {customers.length === 0 && <p className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5 text-sm text-[var(--oc-muted)]">Todavía no cargaste clientes.</p>}
        {customers.map((c) => (
          <div key={c.id} className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4">
            {editingId === c.id ? (
              <>
                <ClientForm defaultValues={c} pending={pending} submitLabel="Guardar cambios" onSubmit={(fd) => handleUpdate(c.id, fd)} />
                <button onClick={() => setEditingId(null)} className="mt-2 text-xs font-bold text-[var(--oc-muted)]">Cancelar</button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--oc-brand-soft)] text-sm font-bold text-[var(--oc-brand)]">{c.name.split(' ').map((n) => n[0]).join('')}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-[var(--oc-ink)]">{c.name}</p>
                    <p className="truncate text-xs text-[var(--oc-muted)]">{[c.phone, c.email, c.address].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {c.phone ? (
                    <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center justify-center rounded-lg bg-[#25D366] px-2 py-2 text-xs font-bold text-white">WhatsApp</a>
                  ) : <span />}
                  <button onClick={() => setEditingId(c.id)} className="flex items-center justify-center gap-1 rounded-lg border border-[var(--oc-border)] px-2 py-2 text-xs font-bold text-[var(--oc-brand)]"><Pencil className="size-3.5" />Editar</button>
                  <button onClick={() => { if (window.confirm(`¿Borrar a ${c.name}?`)) startTransition(() => { deleteCustomer(c.id) }) }} className="flex items-center justify-center gap-1 rounded-lg border border-[var(--oc-border)] px-2 py-2 text-xs font-bold text-[var(--oc-coral)]"><Trash2 className="size-3.5" />Borrar</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

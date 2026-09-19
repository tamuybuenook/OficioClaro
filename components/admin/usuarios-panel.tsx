'use client'

import { useState, useTransition } from 'react'
import { updateUser, deleteUser, adminSetUserPlan } from '@/lib/actions/adminUsers'

type Plan = { id: string; name: string }
type User = { id: string; full_name: string | null; role: string; created_at: string; subscription: { plan_id: string; status: string } | null }

export function UsuariosPanel({ users, plans }: { users: User[]; plans: Plan[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save(userId: string, formData: FormData) {
    startTransition(async () => {
      const res = await updateUser(userId, formData)
      if (res && 'error' in res) setError(res.error)
      setEditing(null)
    })
  }

  function remove(userId: string, name: string) {
    if (!window.confirm(`¿Borrar a ${name || 'este usuario'}? Es permanente.`)) return
    startTransition(async () => {
      const res = await deleteUser(userId)
      if (res && 'error' in res) setError(res.error)
    })
  }

  function changePlan(userId: string, planId: string, status: string) {
    if (!planId) return
    startTransition(async () => {
      const res = await adminSetUserPlan(userId, planId, status as any)
      if (res && 'error' in res) setError(res.error)
    })
  }

  return (
    <div>
      {error && <p className="mt-3 rounded-xl bg-[#fdecea] p-3 text-sm font-semibold text-[var(--oc-coral)]">{error}</p>}
      <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)]">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead><tr className="border-b border-[var(--oc-border-soft)] text-xs text-[var(--oc-muted)]"><th className="p-3">Nombre</th><th>Rol</th><th>Plan</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--oc-border-soft)] last:border-0">
                {editing === u.id ? (
                  <td colSpan={5} className="p-3">
                    <form action={(fd) => save(u.id, fd)} className="flex flex-wrap items-center gap-2">
                      <input name="full_name" defaultValue={u.full_name ?? ''} placeholder="Nombre" className="rounded-lg border border-[var(--oc-border)] p-2 text-sm" />
                      <select name="role" defaultValue={u.role} className="rounded-lg border border-[var(--oc-border)] p-2 text-sm">
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                      <button type="submit" disabled={pending} className="rounded-lg bg-[var(--oc-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">Guardar</button>
                      <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-[var(--oc-border)] px-3 py-2 text-xs font-bold">Cancelar</button>
                    </form>
                  </td>
                ) : (
                  <>
                    <td className="p-3">{u.full_name || '—'}</td>
                    <td>{u.role}</td>
                    <td>
                      <select
                        disabled={pending}
                        defaultValue={u.subscription?.plan_id ?? ''}
                        onChange={(e) => changePlan(u.id, e.target.value, u.subscription?.status ?? 'active')}
                        className="rounded-lg border border-[var(--oc-border)] p-1.5 text-xs"
                      >
                        <option value="" disabled>Sin plan</option>
                        {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        disabled={pending || !u.subscription}
                        defaultValue={u.subscription?.status ?? 'active'}
                        onChange={(e) => u.subscription && changePlan(u.id, u.subscription.plan_id, e.target.value)}
                        className="rounded-lg border border-[var(--oc-border)] p-1.5 text-xs"
                      >
                        <option value="trial">trial</option>
                        <option value="active">active</option>
                        <option value="suspended">suspended</option>
                        <option value="cancelled">cancelled</option>
                      </select>
                    </td>
                    <td className="flex gap-3 p-3">
                      <button onClick={() => setEditing(u.id)} className="text-xs font-bold text-[var(--oc-brand)]">Editar</button>
                      <button disabled={pending} onClick={() => remove(u.id, u.full_name ?? '')} className="text-xs font-bold text-[var(--oc-coral)]">Borrar</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

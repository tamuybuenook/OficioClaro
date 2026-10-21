'use client'

import { ActionForm } from '@/components/ui/action-form'
import { updateSubscriptionPolicy } from '@/lib/actions/appSettings'

export function PolicyForm({ noticeDays, graceDays }: { noticeDays: number; graceDays: number }) {
  const input = 'mt-1 w-28 rounded-lg border border-[var(--oc-border)] bg-transparent px-3 py-2 text-base'
  return (
    <ActionForm action={updateSubscriptionPolicy} successMessage="Política guardada." className="flex flex-col gap-4">
      <label className="text-sm font-semibold">Aviso previo (días, 1–15)
        <input name="notice_days" type="number" inputMode="numeric" min={1} max={15} step={1} required defaultValue={noticeDays} className={`${input} block`} />
      </label>
      <label className="text-sm font-semibold">Período de gracia (días, 0–30)
        <input name="grace_days" type="number" inputMode="numeric" min={0} max={30} step={1} required defaultValue={graceDays} className={`${input} block`} />
      </label>
      <button type="submit" className="w-fit rounded-lg bg-[var(--oc-primary,#1f3a5f)] px-4 py-2 text-sm font-bold text-white">Guardar</button>
    </ActionForm>
  )
}

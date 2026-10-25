'use client'

import { ActionForm } from '@/components/ui/action-form'
import { updateBankDetails } from '@/lib/actions/appSettings'
import type { BankFields } from '@/lib/settings/payment-config'

export function BankDetailsForm({ holder, cuit, cbu, alias }: BankFields) {
  const input = 'mt-1 block w-full max-w-md rounded-lg border border-[var(--oc-border)] bg-transparent px-3 py-2 text-base'
  return (
    <ActionForm action={updateBankDetails} successMessage="Datos bancarios guardados." className="flex flex-col gap-4">
      <label className="text-sm font-semibold">Nombre del titular
        <input name="holder" type="text" required maxLength={120} defaultValue={holder} className={input} />
      </label>
      <label className="text-sm font-semibold">CUIT/CUIL (11 dígitos)
        <input name="cuit" type="text" inputMode="numeric" required maxLength={20} defaultValue={cuit} placeholder="20-12345678-6" className={input} />
      </label>
      <label className="text-sm font-semibold">CBU/CVU (22 dígitos)
        <input name="cbu" type="text" inputMode="numeric" required maxLength={30} defaultValue={cbu} className={input} />
      </label>
      <label className="text-sm font-semibold">Alias (opcional)
        <input name="alias" type="text" maxLength={20} defaultValue={alias} className={input} />
      </label>
      <button type="submit" className="w-fit rounded-lg bg-[var(--oc-primary,#1f3a5f)] px-4 py-2 text-sm font-bold text-white">Guardar datos bancarios</button>
    </ActionForm>
  )
}

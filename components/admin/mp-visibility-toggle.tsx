'use client'

import { ActionForm } from '@/components/ui/action-form'
import { setMpHidden } from '@/lib/actions/appSettings'

// El botón pide el estado contrario al actual. Solo cambia la visibilidad para los clientes.
export function MpVisibilityToggle({ hidden }: { hidden: boolean }) {
  return (
    <ActionForm action={setMpHidden} successMessage="Cambio guardado." className="flex flex-col gap-3">
      <input type="hidden" name="hidden" value={String(!hidden)} />
      <button type="submit" className="w-fit rounded-lg bg-[var(--oc-primary,#1f3a5f)] px-4 py-2 text-sm font-bold text-white">{hidden ? 'Volver a mostrar Mercado Pago' : 'Ocultar Mercado Pago a los clientes'}</button>
    </ActionForm>
  )
}

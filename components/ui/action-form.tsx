'use client'

import { useActionState } from 'react'

type ActionResult = { error?: string } | void | undefined
type State = { error: string | null; saved: boolean }

// Formulario que ejecuta una Server Action y MUESTRA su error (antes los formularios de login,
// registro y perfil descartaban el resultado y el usuario no veía por qué fallaba).
export function ActionForm({
  action,
  children,
  className,
  successMessage,
}: {
  action: (formData: FormData) => Promise<ActionResult> | ActionResult
  children: React.ReactNode
  className?: string
  successMessage?: string
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => {
      try {
        const res = await action(formData)
        if (res && typeof res === 'object' && 'error' in res && res.error) return { error: res.error, saved: false }
        return { error: null, saved: true }
      } catch (e) {
        // redirect() de Next lanza una excepción especial que debe propagarse
        if (e && typeof e === 'object' && 'digest' in e && String((e as any).digest).startsWith('NEXT_REDIRECT')) throw e
        return { error: 'No se pudo completar la operación. Revisá tu conexión e intentá de nuevo.', saved: false }
      }
    },
    { error: null, saved: false },
  )

  return (
    <form action={formAction} className={className} aria-busy={pending}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      {state.error && <p role="alert" className="text-sm font-semibold text-[var(--oc-coral)]">{state.error}</p>}
      {state.saved && successMessage && <p role="status" className="text-sm font-semibold text-[var(--oc-success-text)]">{successMessage}</p>}
    </form>
  )
}

import { requestPasswordReset } from '@/lib/actions/auth'
import { RESET_REQUEST_MESSAGE } from '@/lib/auth/messages'
import { ActionForm } from '@/components/ui/action-form'
import { SubmitButton } from '@/components/auth/submit-button'
import { AuthShell } from '@/components/auth/auth-shell'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Recuperar contraseña — OficioClaro' }

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/')
  const { sent, error } = await searchParams

  return (
    <AuthShell
      title="Recuperá tu contraseña"
      subtitle="Ingresá tu email y te enviamos un enlace para crear una nueva."
      side={{ heading: 'Volvé a entrar en un minuto.', text: 'Tus precios, clientes y presupuestos siguen esperándote.' }}
    >
      {error === 'link' && <p role="alert" className="mt-6 text-[15px] font-semibold text-[var(--oc-coral)]">El enlace no es válido o ya venció. Pedí uno nuevo acá abajo.</p>}
      {sent === '1' ? (
        <p role="status" className="mt-8 text-[17px] font-semibold text-[var(--oc-success-text)]">{RESET_REQUEST_MESSAGE}</p>
      ) : (
        <ActionForm action={requestPasswordReset} className="mt-8 flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-[15px] font-bold">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" className="lp-input" />
          </div>
          <SubmitButton pendingText="Enviando…">Enviar enlace</SubmitButton>
        </ActionForm>
      )}
      <p className="mt-7 text-center text-[17px] text-[var(--lp-ink-soft)]"><a href="/login" className="font-bold text-[var(--lp-brand)] underline underline-offset-4">Volver a ingresar</a></p>
    </AuthShell>
  )
}

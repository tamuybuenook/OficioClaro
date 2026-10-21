import { signIn } from '@/lib/actions/auth'
import { ActionForm } from '@/components/ui/action-form'
import { GoogleButton } from '@/components/auth/google-button'
import { PasswordField } from '@/components/auth/password-field'
import { SubmitButton } from '@/components/auth/submit-button'
import { AuthShell } from '@/components/auth/auth-shell'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Ingresar — OficioClaro' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/')
  const { reset } = await searchParams

  return (
    <AuthShell
      title="Ingresar a tu cuenta"
      subtitle="Volvé a tus precios, clientes y presupuestos."
      side={{ heading: 'Tu oficio vale. Organizarlo no debería ser complicado.', text: 'Consultá precios de referencia y definí los tuyos en minutos.' }}
    >
      {reset === 'ok' && <p role="status" className="mt-6 text-[15px] font-semibold text-[var(--oc-success-text)]">Contraseña actualizada. Ya podés ingresar con la nueva.</p>}
      <div className="mt-8"><GoogleButton /></div>
      <div className="my-6 flex items-center gap-3 text-sm text-[var(--lp-ink-soft)]"><span className="h-px flex-1 bg-[var(--lp-line)]" />o con tu email<span className="h-px flex-1 bg-[var(--lp-line)]" /></div>

      <ActionForm action={signIn} className="flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-[15px] font-bold">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" className="lp-input" />
        </div>
        <PasswordField autoComplete="current-password" />
        <a href="/forgot-password" className="-mt-2 self-end text-[15px] font-bold text-[var(--lp-brand)] underline underline-offset-4">Olvidé mi contraseña</a>
        <SubmitButton pendingText="Ingresando…">Ingresar</SubmitButton>
      </ActionForm>

      <p className="mt-7 text-center text-[17px] text-[var(--lp-ink-soft)]">¿No tenés cuenta? <a href="/register" className="font-bold text-[var(--lp-brand)] underline underline-offset-4">Creá una gratis</a></p>
    </AuthShell>
  )
}

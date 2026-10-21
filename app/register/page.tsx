import { signUp } from '@/lib/actions/auth'
import { ActionForm } from '@/components/ui/action-form'
import { GoogleButton } from '@/components/auth/google-button'
import { PasswordField } from '@/components/auth/password-field'
import { SubmitButton } from '@/components/auth/submit-button'
import { AuthShell } from '@/components/auth/auth-shell'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Crear cuenta — OficioClaro' }

export default async function RegisterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/')

  return (
    <AuthShell
      title="Creá tu cuenta"
      subtitle={<><strong className="text-[var(--lp-salvia)]">30 días gratis · sin tarjeta.</strong> Consultá precios de referencia y armá tus presupuestos.</>}
      side={{ heading: 'Empezá con una referencia clara.', text: 'Registrate, elegí tu oficio y buscá el trabajo que necesitás.' }}
    >
      <div className="mt-8"><GoogleButton /></div>
      <div className="my-6 flex items-center gap-3 text-sm text-[var(--lp-ink-soft)]"><span className="h-px flex-1 bg-[var(--lp-line)]" />o con tu email<span className="h-px flex-1 bg-[var(--lp-line)]" /></div>

      <ActionForm action={signUp} className="flex flex-col gap-4">
        <div>
          <label htmlFor="full_name" className="mb-1.5 block text-[15px] font-bold">Nombre completo</label>
          <input id="full_name" name="full_name" type="text" required autoComplete="name" className="lp-input" />
        </div>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-[15px] font-bold">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" className="lp-input" />
        </div>
        <PasswordField autoComplete="new-password" minLength={6} hint="Mínimo 6 caracteres." />
        <SubmitButton pendingText="Creando tu cuenta…">Crear cuenta</SubmitButton>
      </ActionForm>

      <p className="mt-7 text-center text-[17px] text-[var(--lp-ink-soft)]">¿Ya tenés cuenta? <a href="/login" className="font-bold text-[var(--lp-brand)] underline underline-offset-4">Ingresá</a></p>
    </AuthShell>
  )
}

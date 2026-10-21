import { updatePassword } from '@/lib/actions/auth'
import { ActionForm } from '@/components/ui/action-form'
import { PasswordField } from '@/components/auth/password-field'
import { SubmitButton } from '@/components/auth/submit-button'
import { AuthShell } from '@/components/auth/auth-shell'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Nueva contraseña — OficioClaro' }

export default async function ResetPasswordPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const side = { heading: 'Elegí una contraseña nueva.', text: 'Después vas a ingresar con ella.' }

  if (!user) {
    return (
      <AuthShell title="Enlace no válido" subtitle="El enlace venció o ya fue usado." side={side}>
        <a href="/forgot-password" className="lp-btn lp-btn-primary mt-8 w-full">Pedir un enlace nuevo</a>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Creá tu nueva contraseña" subtitle="Escribila dos veces para evitar errores." side={side}>
      <ActionForm action={updatePassword} className="mt-8 flex flex-col gap-4">
        <PasswordField id="password" autoComplete="new-password" minLength={6} label="Contraseña nueva" hint="Mínimo 6 caracteres." />
        <PasswordField id="confirm" name="confirm" autoComplete="new-password" minLength={6} label="Repetí la contraseña" />
        <SubmitButton pendingText="Guardando…">Guardar contraseña</SubmitButton>
      </ActionForm>
    </AuthShell>
  )
}

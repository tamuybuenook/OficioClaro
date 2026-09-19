import { signIn } from '@/lib/actions/auth'
import { GoogleButton } from '@/components/auth/google-button'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function LoginPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/')

  return (
    <main className="flex min-h-dvh bg-[var(--oc-page)] text-[var(--oc-ink)]">
      {/* Panel de identidad (oculto en mobile) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-[linear-gradient(155deg,var(--oc-hero-from),var(--oc-hero-via)_55%,var(--oc-hero-to))] p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-white/5" />
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-white/70">OficioClaro</p>
        <div>
          <h1 className="max-w-sm text-4xl font-bold leading-tight tracking-tight">Precios claros para tu oficio.</h1>
          <p className="mt-4 max-w-xs text-sm text-white/70">Consultá una referencia y armá tu propia lista de precios en minutos.</p>
        </div>
        <p className="text-xs text-white/50">© 2026 OficioClaro</p>
      </div>

      {/* Formulario */}
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-10 lg:w-1/2 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--oc-brand)] lg:hidden">OficioClaro</p>
          <h1 className="mt-1 text-2xl font-bold">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-[var(--oc-muted)]">Volvé a tu lista de precios.</p>

          <div className="mt-7">
            <GoogleButton />
          </div>
          <div className="my-6 flex items-center gap-3 text-xs text-[var(--oc-muted)]"><span className="h-px flex-1 bg-[var(--oc-border)]" />o con tu email<span className="h-px flex-1 bg-[var(--oc-border)]" /></div>

          <form action={signIn} className="flex flex-col gap-3">
            <input name="email" type="email" placeholder="Email" required className="rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-3.5 text-sm outline-none focus:border-[var(--oc-brand)]" />
            <input name="password" type="password" placeholder="Contraseña" required className="rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-3.5 text-sm outline-none focus:border-[var(--oc-brand)]" />
            <button type="submit" className="mt-1 rounded-xl bg-[var(--oc-coral)] p-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-95">Entrar</button>
          </form>

          <p className="mt-6 text-center text-sm text-[var(--oc-muted)]">¿No tenés cuenta? <a href="/register" className="font-bold text-[var(--oc-brand)] underline">Creá una gratis</a></p>
        </div>
      </div>
    </main>
  )
}

import { signUp } from '@/lib/actions/auth'

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-bold">Crear cuenta</h1>
      <form action={signUp} className="flex flex-col gap-3">
        <input name="full_name" type="text" placeholder="Nombre completo" required className="rounded-lg border p-3" />
        <input name="email" type="email" placeholder="Email" required className="rounded-lg border p-3" />
        <input name="password" type="password" placeholder="Contraseña" required minLength={6} className="rounded-lg border p-3" />
        <button type="submit" className="rounded-lg bg-black p-3 text-white">Registrarme</button>
      </form>
      <a href="/login" className="text-sm underline">Ya tengo cuenta</a>
    </main>
  )
}

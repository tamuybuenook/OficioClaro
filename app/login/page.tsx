import { signIn } from '@/lib/actions/auth'

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-bold">Iniciar sesión</h1>
      <form action={signIn} className="flex flex-col gap-3">
        <input name="email" type="email" placeholder="Email" required className="rounded-lg border p-3" />
        <input name="password" type="password" placeholder="Contraseña" required className="rounded-lg border p-3" />
        <button type="submit" className="rounded-lg bg-black p-3 text-white">Entrar</button>
      </form>
      <a href="/register" className="text-sm underline">Crear cuenta</a>
    </main>
  )
}

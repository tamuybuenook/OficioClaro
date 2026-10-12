import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Sin genérico Database: lib/supabase/types.ts es un tipado manual incompleto (convertía casi todo en `never`).
// Reemplazar por los tipos generados (`supabase gen types typescript`) cuando haya acceso al proyecto.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Se llama desde un Server Component: el middleware refresca la sesión.
          }
        },
      },
    },
  )
}

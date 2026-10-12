import { createClient } from '@/lib/supabase/server'

// Verificación explícita de administrador para Server Actions (defensa en profundidad:
// RLS y las funciones SQL también lo exigen). No usa claves de servicio.
export async function getAdminContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' as const }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { error: 'Solo un administrador puede realizar esta acción.' as const }
  return { supabase, user }
}

// Los errores de PostgreSQL (raise exception) llegan como "message": se muestran tal cual al admin.
export function cleanDbError(message: string): string {
  return message.replace(/^.*?ERROR:\s*/, '')
}

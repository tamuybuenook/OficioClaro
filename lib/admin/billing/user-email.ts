// Email del usuario (vive en auth.users, no en profiles). Solo lectura, solo servidor, y SOLO después de
// requireAdmin() en la página que lo llama. Usa el cliente de servicio únicamente para esta consulta.
import { createAdminClient } from '@/lib/supabase/admin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function fetchUserEmail(userId: string): Promise<string | null> {
  if (!UUID_RE.test(userId)) return null
  try {
    const { data, error } = await createAdminClient().auth.admin.getUserById(userId)
    if (error) return null
    return data.user?.email ?? null
  } catch { return null }
}

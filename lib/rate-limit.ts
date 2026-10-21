// Limitación de frecuencia respaldada por Postgres (rate_limit_hit, migración 0024):
// el contador es compartido entre todas las instancias de Vercel (no usa memoria local).
// Falla cerrado: si no se puede verificar, la acción sensible no se ejecuta.
import { createAdminClient } from '@/lib/supabase/admin'

export const RATE_MESSAGE = 'Demasiados intentos. Probá de nuevo en unos minutos.'

export const LIMITS = {
  checkout: [{ max: 6, seconds: 600 }, { max: 30, seconds: 86_400 }],
  sync: [{ max: 20, seconds: 600 }],
  cancel: [{ max: 5, seconds: 3600 }],
  transfer: [{ max: 5, seconds: 86_400 }],
} as const

export async function allow(userId: string, bucket: keyof typeof LIMITS, db: { rpc: (fn: string, args: any) => PromiseLike<{ data: any; error: any }> } = createAdminClient()): Promise<boolean> {
  for (const [i, l] of LIMITS[bucket].entries()) {
    const { data, error } = await db.rpc('rate_limit_hit', { p_key: `${bucket}:${i}:${userId}`, p_max: l.max, p_window_seconds: l.seconds })
    if (error) { console.error('[rate-limit] no disponible'); return false }
    if (data !== true) return false
  }
  return true
}

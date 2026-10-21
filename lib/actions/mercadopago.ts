'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMpConfig } from '@/lib/mercadopago/config'
import { createMpClient } from '@/lib/mercadopago/client'
import { createSupabaseMpStore } from '@/lib/mercadopago/store'
import { cancelRenewal, CheckoutError, startCheckout } from '@/lib/mercadopago/checkout'
import { reconcileIntents } from '@/lib/mercadopago/reconcile'
import { allow, RATE_MESSAGE } from '@/lib/rate-limit'
import { revalidatePath } from 'next/cache'

const UNAVAILABLE = 'Los pagos online no están disponibles por el momento.'

async function context() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  let config
  try { config = getMpConfig() } catch { console.error('[mp] configuración incompleta'); return { user, deps: null } }
  return { user, deps: { store: createSupabaseMpStore(createAdminClient()), mp: createMpClient(config), appUrl: config.appUrl } }
}

// El cliente solo elige plan y modo; precio, monto y usuario salen del servidor.
export async function startMpCheckout(planId: string, mode: 'one_time' | 'recurring', payerEmail?: string): Promise<{ url?: string; error?: string }> {
  if (mode !== 'one_time' && mode !== 'recurring') return { error: 'Modo de pago inválido.' }
  const ctx = await context()
  if (!ctx) return { error: 'No autenticado' }
  if (!ctx.deps) return { error: UNAVAILABLE }
  if (!(await allow(ctx.user.id, 'checkout'))) return { error: RATE_MESSAGE }
  try {
    return await startCheckout(ctx.deps, { userId: ctx.user.id, email: ctx.user.email ?? null, planId: String(planId), mode, payerEmail: typeof payerEmail === 'string' ? payerEmail.slice(0, 254) : null })
  } catch (e) {
    if (e instanceof CheckoutError) return { error: e.message }
    console.error('[mp] checkout', (e as Error)?.message)
    return { error: UNAVAILABLE }
  }
}

export async function cancelMpRenewal(): Promise<{ ok?: true; error?: string }> {
  const ctx = await context()
  if (!ctx) return { error: 'No autenticado' }
  if (!ctx.deps) return { error: UNAVAILABLE }
  if (!(await allow(ctx.user.id, 'cancel'))) return { error: RATE_MESSAGE }
  try {
    await cancelRenewal(ctx.deps, ctx.user.id)
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    if (e instanceof CheckoutError) return { error: e.message }
    console.error('[mp] cancel', (e as Error)?.message)
    return { error: UNAVAILABLE }
  }
}

// Verifica contra Mercado Pago las operaciones pendientes del propio usuario (botón "Ya pagué" y sondeo tras volver del pago).
export async function syncMyPayments(): Promise<{ processed?: number; error?: string }> {
  const ctx = await context()
  if (!ctx) return { error: 'No autenticado' }
  if (!ctx.deps) return { error: UNAVAILABLE }
  if (!(await allow(ctx.user.id, 'sync'))) return { error: RATE_MESSAGE }
  try {
    const r = await reconcileIntents(ctx.deps, { userId: ctx.user.id, olderThanMinutes: 0, newerThanHours: 72, limit: 5 })
    if (r.processed > 0) revalidatePath('/')
    return { processed: r.processed }
  } catch (e) {
    console.error('[mp] sync', (e as Error)?.message)
    return { error: UNAVAILABLE }
  }
}

// Acceso real del usuario según la FASE de su suscripción (etapa 6c). Lo usan la página, las acciones del servidor y el límite de oficios.
// Reglas: ver docs/INFORME_CIERRE_ETAPA6C.md. Un usuario "bloqueado" puede entrar, pero solo ve la pantalla de Suscripción/pago.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getSubscriptionPhase, type PhaseResult } from '@/lib/subscription-phase'
import { settingsFromRows } from '@/lib/settings/policy'
import { todayAR } from '@/lib/subscription-access'

export const LOCKED_MESSAGE = 'Tu suscripción no está al día. Regularizá el pago en «Suscripción» para volver a usar OficioClaro.'

export type MyAccess = PhaseResult & {
  /** true = solo puede ver Suscripción/pago. Los administradores nunca se bloquean. */
  locked: boolean
  isAdmin: boolean
  subStatus: string | null
  maxTrades: number | null
  /** Datos de la suscripción usados para calcular avisos (etapa 7). */
  subscriptionId: string | null
  endDate: string | null
  noticeDays: number
  /** true si no se pudo leer la suscripción (error de base): no se bloquea por un fallo técnico. */
  degraded: boolean
}

const NO_USER: MyAccess = { phase: 'none', hasAccess: false, daysToEnd: null, graceEndsOn: null, locked: true, isAdmin: false, subStatus: null, maxTrades: null, subscriptionId: null, endDate: null, noticeDays: 5, degraded: false }

export async function getMyAccess(): Promise<MyAccess> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NO_USER
  return computeAccess(supabase, user.id)
}

/** Cálculo del acceso de un usuario con el cliente indicado (sesión del usuario, o service role desde el cron). */
export async function computeAccess(supabase: SupabaseClient, userId: string): Promise<MyAccess> {
  const user = { id: userId }

  const [profileRes, subRes, settingsRes] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    // `plans!plan_id`: subscriptions tiene dos claves hacia plans (plan_id y mp_plan_id); se indica cuál usar.
    supabase.from('subscriptions').select('id, status, end_date, mp_status, cancelled_at, plans!plan_id(max_trades)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('app_settings').select('key, value'),
  ])
  const isAdmin = (profileRes.data as any)?.role === 'admin'
  const settings = settingsFromRows(settingsRes.error ? null : settingsRes.data)

  if (subRes.error) {
    console.error('[access] no se pudo leer la suscripción:', (subRes.error as any).code ?? '')
    return { ...NO_USER, locked: false, isAdmin, degraded: true, noticeDays: settings.noticeDays }
  }
  const sub = subRes.data as any
  if (!sub) return { ...NO_USER, locked: !isAdmin, isAdmin, noticeDays: settings.noticeDays }

  // El pago previo solo importa si el período ya venció (única situación en la que puede haber gracia).
  let hasPaidBefore = false
  if (sub.end_date && sub.end_date < todayAR() && (sub.status === 'active' || sub.status === 'past_due')) {
    const { data } = await supabase.from('payments').select('id').eq('subscription_id', sub.id).eq('status', 'reconciled').limit(1)
    hasPaidBefore = (data?.length ?? 0) > 0
  }

  const phase = getSubscriptionPhase({
    status: sub.status,
    end_date: sub.end_date,
    autoRenewal: sub.mp_status === 'authorized',
    renewalCancelled: sub.mp_status === 'cancelled' || !!sub.cancelled_at,
    hasPaidBefore,
  }, settings)

  const plan = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans
  return { ...phase, locked: !isAdmin && !phase.hasAccess, isAdmin, subStatus: sub.status, maxTrades: plan?.max_trades ?? null, subscriptionId: sub.id, endDate: sub.end_date ?? null, noticeDays: settings.noticeDays, degraded: false }
}

/** Para acciones que modifican datos: devuelve `{ error }` si el usuario está bloqueado, o null si puede continuar. */
export async function requireFullAccess(): Promise<{ error: string } | null> {
  const access = await getMyAccess()
  return access.locked ? { error: LOCKED_MESSAGE } : null
}

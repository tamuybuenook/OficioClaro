// Sincroniza los avisos de un usuario con su situación real (etapa 7a). Lo usan la página (7b) y el cron (etapa 8).
// Nunca lanza: un fallo de avisos no debe romper la pantalla ni el cron. Si no puede leer datos, NO escribe nada
// (así un error técnico nunca resuelve avisos que siguen vigentes).
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeAccess, type MyAccess } from '@/lib/services/access'
import { todayAR } from '@/lib/subscription-access'
import { desiredNotifications, inSync } from './rules'

export type SyncOutcome =
  | { ok: true; skipped: boolean; desired: number; created?: number; reopened?: number; resolved?: number }
  | { ok: false; reason: 'degraded' | 'read_error' | 'rpc_error' | 'unexpected' }

const fail = (reason: Extract<SyncOutcome, { ok: false }>['reason'], detail?: unknown): SyncOutcome => {
  console.error('[notifications] sync no completada:', reason, (detail as any)?.code ?? '')
  return { ok: false, reason }
}

/** `access`: si la página ya calculó el acceso del usuario, se reutiliza (ahorra 4 consultas). */
export async function syncNotifications(userId: string, opts: { db?: SupabaseClient; now?: Date; access?: MyAccess } = {}): Promise<SyncOutcome> {
  try {
    const client = opts.db ?? createAdminClient()
    const today = todayAR(opts.now ?? new Date())
    const access = opts.access ?? (await computeAccess(client, userId))
    if (access.degraded) return fail('degraded')

    let lastPayment: { id: string; date: string } | null = null
    if (access.subscriptionId) {
      const { data, error } = await client.from('payments').select('id, applied_at, updated_at')
        .eq('subscription_id', access.subscriptionId).eq('status', 'reconciled')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
      if (error) return fail('read_error', error)
      const p = data as { id: string; applied_at: string | null; updated_at: string } | null
      if (p) lastPayment = { id: p.id, date: todayAR(new Date(p.applied_at ?? p.updated_at)) }
    }

    const desired = access.subscriptionId
      ? desiredNotifications({
          subscriptionId: access.subscriptionId, phase: access.phase, daysToEnd: access.daysToEnd, graceEndsOn: access.graceEndsOn,
          endDate: access.endDate, subStatus: access.subStatus, noticeDays: access.noticeDays, lastPayment, today,
        })
      : []

    const { data: open, error: openErr } = await client.from('notifications').select('dedupe_key').eq('user_id', userId).eq('status', 'open')
    if (openErr) return fail('read_error', openErr)
    if (inSync((open ?? []).map((r: any) => r.dedupe_key), desired)) return { ok: true, skipped: true, desired: desired.length }

    const { data: res, error: rpcErr } = await client.rpc('sync_notifications', { p_user_id: userId, p_desired: desired })
    if (rpcErr) return fail('rpc_error', rpcErr)
    return { ok: true, skipped: false, desired: desired.length, ...(res as { created: number; reopened: number; resolved: number }) }
  } catch (e) {
    return fail('unexpected', e)
  }
}

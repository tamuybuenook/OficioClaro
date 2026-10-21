import type { SupabaseClient } from '@supabase/supabase-js'
import { RECONCILE_FAILED_ACTION, RECONCILE_RUN_ACTION } from '@/lib/mercadopago/reconcile-log'
import { evaluateReconcile, type ReconcileLog, type ReconcileStatus } from './mp-settings'

/** Último resultado real de la conciliación periódica (lo que dejó registrado la ruta del cron). */
export async function fetchReconcileStatus(db: SupabaseClient, cronSecretPresent: boolean): Promise<ReconcileStatus & { lastSuccess: ReconcileLog | null }> {
  const [latest, success] = await Promise.all([
    db.from('audit_logs').select('action, created_at, new_value').in('action', [RECONCILE_RUN_ACTION, RECONCILE_FAILED_ACTION]).order('created_at', { ascending: false }).limit(1),
    db.from('audit_logs').select('action, created_at, new_value').eq('action', RECONCILE_RUN_ACTION).order('created_at', { ascending: false }).limit(1),
  ])
  if (latest.error) throw new Error(`conciliación: ${latest.error.message}`)
  const last = ((latest.data ?? [])[0] as ReconcileLog | undefined) ?? null
  const lastSuccess = ((success.data ?? [])[0] as ReconcileLog | undefined) ?? null
  return { ...evaluateReconcile(last, { cronSecretPresent }), lastSuccess }
}

// Registro de cada ejecución de la conciliación periódica en audit_logs (sin migración: tabla existente).
// Permite que /admin/configuracion muestre el último resultado real. Nunca guarda secretos ni payloads de MP.
import type { SupabaseClient } from '@supabase/supabase-js'

export const RECONCILE_RUN_ACTION = 'mp_reconcile_run'
export const RECONCILE_FAILED_ACTION = 'mp_reconcile_failed'

export async function logReconcileRun(db: SupabaseClient, action: typeof RECONCILE_RUN_ACTION | typeof RECONCILE_FAILED_ACTION, detail: Record<string, unknown>): Promise<void> {
  try {
    await db.from('audit_logs').insert({ actor_id: null, entity: 'mp_reconcile', entity_id: null, action, new_value: detail })
  } catch { /* la auditoría no debe romper la conciliación */ }
}

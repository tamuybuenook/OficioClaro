// Conciliación activa: red de seguridad ante webhooks perdidos o fallos de base al guardar el resultado.
// Para cada operación local pendiente busca en MP los pagos con su external_reference y los procesa
// por el mismo camino (y las mismas validaciones) que el webhook.
import type { MpClient } from './client'
import type { MpStore } from './store'
import { processMpEvent } from './process-event'

export async function reconcileIntents(
  deps: { mp: MpClient; store: MpStore },
  f: { userId?: string; olderThanMinutes: number; newerThanHours: number; limit: number },
): Promise<{ checked: number; processed: number; errors: number }> {
  const intents = await deps.store.listOpenIntents(f)
  let processed = 0
  let errors = 0
  for (const it of intents) {
    try {
      const res = await deps.mp.request<{ results?: { id: number | string }[] }>(
        'GET', `/v1/payments/search?external_reference=${encodeURIComponent(it.id)}&sort=date_created&criteria=desc&limit=5`)
      for (const p of res.results ?? []) {
        const out = await processMpEvent(deps, { topic: 'payment', dataId: String(p.id) })
        if (out.outcome === 'processed') processed += 1
      }
    } catch { errors += 1 }
  }
  return { checked: intents.length, processed, errors }
}

export { recoverPreapprovals } from './preapprovals'

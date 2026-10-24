// Sincronización entre dispositivos. Cada dispositivo guarda el último "sello" de cambios que vio
// (my_sync_stamp, migración 0035: solo contadores y fechas del propio usuario). Si el sello cambió, otra sesión
// modificó datos: se invalidan las listas correspondientes y se vuelven a pedir.
// El sello solo decide si hay que refrescar; NUNCA se usa para autorizar nada.
import { getOwner, invalidate, read, write } from '@/lib/cache/store'

export type SyncStamp = Record<string, string | null>
const STAMP_KEY = '__sync_stamp'
const MIN_INTERVAL_MS = 30_000

// qué listas locales dependen de cada parte del sello
export const STAMP_SCOPES: Record<string, string[]> = {
  own_catalog: ['concepts:own', 'catalogo:'],
  own_prices: ['concepts:service'],
  trades: ['concepts:service'],
  ut: ['concepts:service'],
  master: ['concepts:service'],
}

let lastCheck = 0
let running: Promise<string[]> | null = null

/** Devuelve las listas invalidadas. `force` ignora el intervalo mínimo entre controles. */
export function checkSync(fetchStamp: () => Promise<SyncStamp | null>, opts: { force?: boolean } = {}): Promise<string[]> {
  if (!getOwner()) return Promise.resolve([])
  if (running) return running
  if (!opts.force && Date.now() - lastCheck < MIN_INTERVAL_MS) return Promise.resolve([])
  running = (async () => {
    try {
      const fresh = await fetchStamp()
      lastCheck = Date.now()
      if (!fresh) return []
      const prev = (await read<SyncStamp>(STAMP_KEY))?.value ?? null
      const changed: string[] = []
      if (prev) {
        for (const part of Object.keys(STAMP_SCOPES)) {
          if (prev[part] !== fresh[part]) {
            for (const scope of STAMP_SCOPES[part]) if (!changed.includes(scope)) changed.push(scope)
          }
        }
        for (const scope of changed) await invalidate(scope, { broadcast: true })
      }
      await write(STAMP_KEY, fresh)
      return changed
    } catch {
      return [] // sin conexión: se sigue con los datos guardados y se reintenta luego
    } finally {
      running = null
    }
  })()
  return running
}

/**
 * Después de que ESTE dispositivo modifica datos: se anota el sello nuevo sin invalidar otra vez
 * (la invalidación local ya se hizo), para que el próximo control no cuente el cambio propio como ajeno.
 */
export async function acceptLocalChange(fetchStamp: () => Promise<SyncStamp | null>): Promise<void> {
  if (!getOwner()) return
  try {
    const fresh = await fetchStamp()
    if (fresh) await write(STAMP_KEY, fresh)
  } catch { /* sin conexión: el siguiente control lo resolverá */ }
}

export function _resetSyncForTests() { lastCheck = 0; running = null }

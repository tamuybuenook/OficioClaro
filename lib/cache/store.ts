// Caché local por dispositivo: memoria (reutilización durante la navegación) + IndexedDB (sobrevive a recargas).
// Supabase sigue siendo la fuente oficial. Esta capa SOLO acelera lecturas:
//   - nunca decide permisos, accesos ni pagos (eso se verifica siempre en el servidor y en la base);
//   - nunca guarda credenciales, tokens ni datos de suscripción;
//   - todo dato lleva el id del dueño en la clave, y al cambiar de cuenta o cerrar sesión se descarta.
import { idbAvailable, idbClearAll, idbClearOwner, idbDeletePrefix, idbGet, idbList, idbPurgeOthers, idbPut, idbDelete, type Rec } from '@/lib/cache/idb'

type Entry<T = unknown> = { value: T; savedAt: number }

const MEMORY_LIMIT = 300
const DISK_LIMIT = 200 // entradas de consulta por dueño (las más viejas se descartan)
const CHANNEL = 'oficioclaro-cache'

let owner: string | null = null
const memory = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()
const listeners = new Set<{ prefix: string; cb: () => void }>()
let channel: BroadcastChannel | null = null
let writesSincePrune = 0

export const stats = { network: 0, memoryHits: 0, diskHits: 0, deduped: 0 }

export function getOwner() { return owner }

/** Asocia la caché al usuario autenticado. Si cambió la cuenta, se descarta TODO lo del usuario anterior. */
export function bindOwner(userId: string | null): void {
  if (owner === userId) return
  const previous = owner
  owner = userId
  memory.clear()
  inflight.clear()
  if (userId) {
    void idbPurgeOthers(userId) // datos de cualquier otra cuenta que haya quedado en este dispositivo
    openChannel()
  } else {
    closeChannel()
  }
  if (previous && previous !== userId) notify('')
}

/** Cierre de sesión / pantalla de acceso: vacía memoria y disco. `keepDrafts` conserva los borradores (solo en la pantalla de login). */
export async function clearLocalData(opts: { keepDrafts?: boolean } = {}): Promise<void> {
  memory.clear()
  inflight.clear()
  try { await idbClearAll(opts.keepDrafts ? ['cache'] : undefined) } catch { /* sin IndexedDB: no hay nada más que borrar */ }
  if (!opts.keepDrafts) owner = null
  notify('')
}

export const makeKey = (scope: string, params?: unknown) =>
  `${scope}${params === undefined ? '' : '|' + JSON.stringify(params)}`

const mk = (key: string) => (owner ? `${owner}|${key}` : null)

export function peek<T>(key: string): Entry<T> | null {
  const k = mk(key)
  if (!k) return null
  const e = memory.get(k)
  if (!e) return null
  memory.delete(k); memory.set(k, e) // más reciente
  return e as Entry<T>
}

export async function read<T>(key: string): Promise<(Entry<T> & { source: 'memory' | 'disk' }) | null> {
  const hit = peek<T>(key)
  if (hit) { stats.memoryHits++; return { ...hit, source: 'memory' } }
  if (!owner) return null
  const rec = await idbGet<T>('cache', owner, key)
  if (!rec) return null
  stats.diskHits++
  const entry: Entry<T> = { value: rec.v, savedAt: rec.t }
  setMemory(key, entry)
  return { ...entry, source: 'disk' }
}

function setMemory(key: string, e: Entry) {
  const k = mk(key)
  if (!k) return
  memory.set(k, e)
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value as string)
}

export async function write<T>(key: string, value: T): Promise<void> {
  if (!owner) return
  const o = owner
  setMemory(key, { value, savedAt: Date.now() })
  await idbPut('cache', o, key, value)
  if (++writesSincePrune >= 25) { writesSincePrune = 0; void prune(o) }
}

async function prune(o: string) {
  const all = await idbList<unknown>('cache', o)
  if (all.length <= DISK_LIMIT) return
  all.sort((a: Rec, b: Rec) => a.t - b.t)
  for (const r of all.slice(0, all.length - DISK_LIMIT)) await idbDelete('cache', o, r.k.slice(o.length + 1))
}

/** Evita consultas duplicadas: varias llamadas simultáneas con la misma clave comparten una sola solicitud. */
export function dedupe<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const k = mk(key) ?? key
  const existing = inflight.get(k)
  if (existing) { stats.deduped++; return existing as Promise<T> }
  stats.network++
  const p = fetcher().finally(() => { if (inflight.get(k) === p) inflight.delete(k) })
  inflight.set(k, p)
  return p
}

export type LoadResult<T> = { value: T; source: 'memory' | 'disk' | 'network'; fresh: boolean }

/**
 * Lee con la estrategia "datos guardados primero, revalidar si están viejos":
 *  - dentro del TTL: devuelve lo guardado y NO consulta la red;
 *  - vencido: devuelve lo guardado de inmediato (`fresh: false`) para que la pantalla no espere; la revalidación
 *    la dispara quien llama con `revalidate()`;
 *  - sin nada guardado: consulta la red una sola vez (deduplicada) y guarda el resultado.
 */
export async function load<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<LoadResult<T>> {
  const cached = await read<T>(key)
  if (cached) {
    const fresh = Date.now() - cached.savedAt < ttlMs
    return { value: cached.value, source: cached.source, fresh }
  }
  return revalidate(key, fetcher)
}

export async function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<LoadResult<T>> {
  const value = await dedupe(key, fetcher)
  await write(key, value)
  return { value, source: 'network', fresh: true }
}

// ---- invalidación (al crear/editar/borrar o cuando otro dispositivo cambió algo) ----

export async function invalidate(scopePrefix: string, opts: { broadcast?: boolean } = { broadcast: true }): Promise<void> {
  if (!owner) return
  const full = `${owner}|${scopePrefix}`
  for (const k of [...memory.keys()]) if (k.startsWith(full)) memory.delete(k)
  for (const k of [...inflight.keys()]) if (k.startsWith(full)) inflight.delete(k)
  await idbDeletePrefix('cache', owner, scopePrefix)
  notify(scopePrefix)
  if (opts.broadcast !== false) channel?.postMessage({ owner, scopePrefix })
}

/** Las pantallas se suscriben para volver a pedir sus datos cuando algo se invalida. */
export function subscribe(scopePrefix: string, cb: () => void): () => void {
  const entry = { prefix: scopePrefix, cb }
  listeners.add(entry)
  return () => { listeners.delete(entry) }
}

function notify(scopePrefix: string) {
  for (const l of [...listeners]) {
    // se avisa si el prefijo invalidado "contiene" al de la suscripción, o al revés
    if (scopePrefix === '' || l.prefix.startsWith(scopePrefix) || scopePrefix.startsWith(l.prefix)) l.cb()
  }
}

function openChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (ev) => {
      const m = ev.data as { owner?: string; scopePrefix?: string }
      if (m?.owner && m.owner === owner && typeof m.scopePrefix === 'string') void invalidate(m.scopePrefix, { broadcast: false })
    }
  } catch { channel = null }
}
function closeChannel() { try { channel?.close() } catch { /* nada */ } channel = null }

export const _internals = { memory, inflight, idbAvailable }

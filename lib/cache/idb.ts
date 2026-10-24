// Almacenamiento local en IndexedDB (cada dispositivo del usuario). Sin dependencias.
// Dos almacenes: "cache" (datos de consulta, descartables) y "drafts" (borradores de presupuestos).
// TODA clave lleva el id del dueño: `${owner}|${clave}`. Si IndexedDB no existe o falla (modo privado,
// cuota llena), las funciones degradan en silencio: la app sigue funcionando solo con memoria.

export type StoreName = 'cache' | 'drafts'
export type Rec<T = unknown> = { k: string; owner: string; v: T; t: number }

const DB_NAME = 'oficioclaro-local'
const DB_VERSION = 1
const STORES: StoreName[] = ['cache', 'drafts']

let dbPromise: Promise<IDBDatabase | null> | null = null

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function open(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'k' }).createIndex('owner', 'owner')
        }
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => { db.close(); dbPromise = null }
        resolve(db)
      }
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbPromise
}

/** Solo para pruebas: fuerza a reabrir la conexión. */
export function _resetIdbForTests() { dbPromise = null }

async function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise<T | null>((resolve) => {
    try {
      const t = db.transaction(store, mode)
      const req = run(t.objectStore(store))
      t.oncomplete = () => resolve(req ? ((req as IDBRequest).result as T) : null)
      t.onerror = () => resolve(null)
      t.onabort = () => resolve(null)
    } catch { resolve(null) }
  })
}

export const fullKey = (owner: string, key: string) => `${owner}|${key}`

export async function idbGet<T>(store: StoreName, owner: string, key: string): Promise<Rec<T> | null> {
  const r = await tx<Rec<T> | undefined>(store, 'readonly', (s) => s.get(fullKey(owner, key)))
  // Defensa extra: aunque la clave esté bien armada, nunca se devuelve un registro de otro dueño.
  return r && r.owner === owner ? r : null
}

export async function idbPut<T>(store: StoreName, owner: string, key: string, value: T): Promise<boolean> {
  const rec: Rec<T> = { k: fullKey(owner, key), owner, v: value, t: Date.now() }
  const r = await tx<unknown>(store, 'readwrite', (s) => s.put(rec))
  return r !== null
}

export async function idbDelete(store: StoreName, owner: string, key: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(fullKey(owner, key)))
}

/** Borra los registros del dueño cuya clave (sin el dueño) empieza con `prefix`. */
export async function idbDeletePrefix(store: StoreName, owner: string, prefix: string): Promise<void> {
  const db = await open()
  if (!db) return
  const lo = fullKey(owner, prefix)
  await new Promise<void>((resolve) => {
    try {
      const t = db.transaction(store, 'readwrite')
      const s = t.objectStore(store)
      const req = s.openCursor(IDBKeyRange.bound(lo, lo + '\uffff'))
      req.onsuccess = () => {
        const c = req.result
        if (c) { c.delete(); c.continue() }
      }
      t.oncomplete = () => resolve()
      t.onerror = () => resolve()
      t.onabort = () => resolve()
    } catch { resolve() }
  })
}

export async function idbList<T>(store: StoreName, owner: string, prefix = ''): Promise<Rec<T>[]> {
  const db = await open()
  if (!db) return []
  const lo = fullKey(owner, prefix)
  return new Promise<Rec<T>[]>((resolve) => {
    try {
      const out: Rec<T>[] = []
      const t = db.transaction(store, 'readonly')
      const req = t.objectStore(store).openCursor(IDBKeyRange.bound(lo, lo + '\uffff'))
      req.onsuccess = () => {
        const c = req.result
        if (c) { if ((c.value as Rec<T>).owner === owner) out.push(c.value as Rec<T>); c.continue() }
      }
      t.oncomplete = () => resolve(out)
      t.onerror = () => resolve([])
      t.onabort = () => resolve([])
    } catch { resolve([]) }
  })
}

/** Borra todo lo de un dueño en los almacenes indicados. */
export async function idbClearOwner(owner: string, stores: StoreName[] = STORES): Promise<void> {
  for (const s of stores) await idbDeletePrefix(s, owner, '')
}

/** Borra todo lo que NO sea de `keepOwner` (cambio de cuenta). Devuelve los dueños purgados. */
export async function idbPurgeOthers(keepOwner: string | null, stores: StoreName[] = STORES): Promise<void> {
  const db = await open()
  if (!db) return
  for (const name of stores) {
    await new Promise<void>((resolve) => {
      try {
        const t = db.transaction(name, 'readwrite')
        const req = t.objectStore(name).openCursor()
        req.onsuccess = () => {
          const c = req.result
          if (c) { if ((c.value as Rec).owner !== keepOwner) c.delete(); c.continue() }
        }
        t.oncomplete = () => resolve()
        t.onerror = () => resolve()
        t.onabort = () => resolve()
      } catch { resolve() }
    })
  }
}

export async function idbClearAll(stores: StoreName[] = STORES): Promise<void> {
  for (const s of stores) await tx(s, 'readwrite', (st) => st.clear())
}

// Borradores de presupuestos guardados en ESTE dispositivo (IndexedDB), para recuperarlos tras una recarga
// o una pérdida de conexión. No reemplazan al borrador de Supabase: son solo una red de seguridad local.
// Se separan por dueño; al cerrar sesión se borran (ver clearLocalData) y al cambiar de cuenta se descartan.
import { idbDelete, idbGet, idbList, idbPut } from '@/lib/cache/idb'
import { getOwner } from '@/lib/cache/store'
import type { QuoteLine } from '@/lib/quotes'

export type LocalQuoteDraft = {
  requestId: string
  quoteId: string | null
  customer: { id: string; name: string; phone: string | null; address: string | null } | null
  jobId: string | null
  notes: string
  lines: QuoteLine[]
  /** Hora (ms) en que el usuario modificó el formulario por última vez. */
  editedAt: number
}

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // un borrador local sin tocar por 30 días se descarta
const mem = new Map<string, LocalQuoteDraft>() // respaldo si IndexedDB no está disponible

/** Clave estable del borrador: uno por presupuesto existente, o uno por (cliente, trabajo) para los nuevos. */
export function draftKey(p: { quoteId?: string | null; customerId?: string | null; jobId?: string | null }): string {
  return p.quoteId ? `quote:${p.quoteId}` : `new:${p.customerId ?? '-'}:${p.jobId ?? '-'}`
}

const memKey = (owner: string, key: string) => `${owner}|${key}`

export const isEmptyDraft = (d: Pick<LocalQuoteDraft, 'lines' | 'notes'>) => d.lines.length === 0 && !d.notes.trim()

export async function saveLocalDraft(key: string, draft: LocalQuoteDraft): Promise<void> {
  const owner = getOwner()
  if (!owner) return
  if (isEmptyDraft(draft)) { await deleteLocalDraft(key); return } // no se guardan borradores vacíos
  mem.set(memKey(owner, key), draft)
  await idbPut('drafts', owner, key, draft)
}

export async function loadLocalDraft(key: string): Promise<LocalQuoteDraft | null> {
  const owner = getOwner()
  if (!owner) return null
  const rec = await idbGet<LocalQuoteDraft>('drafts', owner, key)
  const d = rec?.v ?? mem.get(memKey(owner, key)) ?? null
  if (!d) return null
  if (Date.now() - d.editedAt > MAX_AGE_MS) { await deleteLocalDraft(key); return null }
  return d
}

export async function deleteLocalDraft(key: string): Promise<void> {
  const owner = getOwner()
  if (!owner) return
  mem.delete(memKey(owner, key))
  await idbDelete('drafts', owner, key)
}

export async function listLocalDrafts(): Promise<{ key: string; draft: LocalQuoteDraft }[]> {
  const owner = getOwner()
  if (!owner) return []
  const rows = await idbList<LocalQuoteDraft>('drafts', owner)
  return rows.map((r) => ({ key: r.k.slice(owner.length + 1), draft: r.v })).filter((r) => Date.now() - r.draft.editedAt <= MAX_AGE_MS)
}

export function _clearDraftMemoryForTests() { mem.clear() }

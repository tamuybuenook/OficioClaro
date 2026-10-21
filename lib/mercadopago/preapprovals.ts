// Ciclo de vida de las autorizaciones recurrentes (preapproval) con ledger y recuperación ante fallos parciales.
// Principios:
//  - Cada preapproval queda registrada ANTES de existir en MP (fila 'creating', su id es el external_reference).
//  - Una autorización anterior se cancela y se CONFIRMA (respuesta o GET) antes de abrir otra; si no puede
//    confirmarse, no se abre otra, se registra la incidencia y el estado queda 'cancelling' (se reintenta).
//  - Una llamada HTTP exitosa no se da por consistente: se verifica contra MP y contra la base.
import { MpApiError, type MpClient } from './client'
import type { MpStore, PreapprovalRow } from './store'

type Deps = { mp: MpClient; store: MpStore }
export const CREATING_STALE_MINUTES = 10

const isNotFound = (e: unknown) => e instanceof MpApiError && e.status === 404
const msg = (e: unknown) => (e instanceof Error ? e.message : 'error desconocido')

async function remoteStatus(mp: MpClient, mpId: string): Promise<string | 'not_found'> {
  try { return String((await mp.request<{ status?: string }>('GET', `/preapproval/${encodeURIComponent(mpId)}`)).status) }
  catch (e) { if (isNotFound(e)) return 'not_found'; throw e }
}

/** Cancela en MP y confirma. ok=false => la autorización puede seguir viva: no se reemplaza, se registra y se reintentará. */
export async function cancelPreapproval(d: Deps, row: PreapprovalRow): Promise<{ ok: boolean; detail?: string }> {
  // Una fila 'creating' sin id de MP: primero hay que averiguar si MP llegó a crearla.
  if (!row.preapproval_id) {
    const r = await resolveCreating(d, row)
    if (r === 'failed') return { ok: true }
    if (r === 'in_progress') return { ok: false, detail: 'creación en curso' }
    const fresh = await d.store.getPreapprovalById(row.id)
    if (!fresh?.preapproval_id) return { ok: false, detail: 'sin id de Mercado Pago' }
    row = fresh
  }
  const mpId = row.preapproval_id!
  await d.store.markCancelling(row.id)

  let confirmed = false
  let error: string | undefined
  try {
    const res = await d.mp.request<{ status?: string }>('PUT', `/preapproval/${encodeURIComponent(mpId)}`, { status: 'cancelled' })
    confirmed = res?.status === 'cancelled'
    if (!confirmed) confirmed = (await remoteStatus(d.mp, mpId)) === 'cancelled'
    if (!confirmed) error = 'Mercado Pago no confirmó la cancelación'
  } catch (e) {
    if (isNotFound(e)) confirmed = true
    else {
      error = msg(e)
      // timeout o error de red/MP: el resultado es incierto, se consulta el estado real.
      try { const st = await remoteStatus(d.mp, mpId); confirmed = st === 'cancelled' || st === 'not_found' } catch { /* sigue sin confirmar */ }
    }
  }

  if (confirmed) {
    await d.store.markCancelled(row.id)
    return { ok: true }
  }
  await d.store.recordCancelFailure(row.id, error ?? 'no confirmada')
  await d.store.logIncident('mp_preapprovals', row.id, 'mp_incident_cancel_unconfirmed', { preapproval_id: mpId, error, attempts: row.cancel_attempts + 1 })
  return { ok: false, detail: error }
}

/**
 * Resuelve una fila 'creating': ¿MP llegó a crearla? (se busca por external_reference = id de la fila).
 * 'attached' = encontrada y vinculada · 'failed' = no existe y ya es vieja (se cierra) · 'in_progress' = reciente, esperar.
 */
export async function resolveCreating(d: Deps, row: PreapprovalRow, now = Date.now()): Promise<'attached' | 'failed' | 'in_progress'> {
  const res = await d.mp.request<{ results?: { id: string; status?: string; init_point?: string }[] }>(
    'GET', `/preapproval/search?external_reference=${encodeURIComponent(row.id)}`)
  const found = res.results?.[0]
  if (found?.id) {
    const remote = String(found.status)
    await d.store.attachPreapproval(row.id, found.id, found.init_point ?? null, remote === 'authorized' ? 'authorized' : remote === 'paused' ? 'paused' : 'pending')
    if (remote === 'cancelled') await d.store.markCancelled(row.id)
    return 'attached'
  }
  const ageMin = (now - new Date(row.created_at).getTime()) / 60_000
  if (ageMin >= CREATING_STALE_MINUTES) {
    await d.store.markPreapprovalFailed(row.id, 'no se creó en Mercado Pago')
    return 'failed'
  }
  return 'in_progress'
}

/** Resuelve la fila local para un id de MP; si la notificación llegó antes de vincular el id, la vincula por external_reference. */
export async function resolveRowByMpId(d: Deps, mpId: string, externalReference: string | null | undefined): Promise<PreapprovalRow | null> {
  const direct = await d.store.getPreapprovalByMpId(mpId)
  if (direct) return direct
  if (externalReference && /^[0-9a-f-]{36}$/i.test(externalReference)) {
    const byRef = await d.store.getPreapprovalById(externalReference)
    if (byRef && !byRef.preapproval_id) {
      await d.store.attachPreapproval(byRef.id, mpId, null)
      return d.store.getPreapprovalById(byRef.id)
    }
  }
  return null
}

/** Red de seguridad periódica: reintenta cancelaciones sin confirmar y cierra/vincula creaciones a medias. */
export async function recoverPreapprovals(d: Deps, f: { olderThanMinutes: number; limit: number }): Promise<{ checked: number; resolved: number; unresolved: number }> {
  const rows = await d.store.listPreapprovalsToRecover(f)
  let resolved = 0
  let unresolved = 0
  for (const row of rows) {
    try {
      if (row.status === 'cancelling') (await cancelPreapproval(d, row)).ok ? resolved++ : unresolved++
      else if (row.status === 'creating') (await resolveCreating(d, row)) === 'in_progress' ? unresolved++ : resolved++
    } catch { unresolved++ }
  }
  return { checked: rows.length, resolved, unresolved }
}

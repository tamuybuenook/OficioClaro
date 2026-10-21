// Qué banner ve el usuario en el inicio (etapa 7b). Pura: recibe la fase y los avisos abiertos ya leídos.
import { accessNotice, type AccessView } from '@/lib/subscription-notice'
import { DISMISSIBLE_KINDS, NOTIFICATION_KINDS, pickBanner, type NotificationKind, type Severity } from './rules'
import { notificationText } from './messages'

export type Banner = { id: string | null; tone: Severity; text: string; dismissible: boolean }
export type NotificationRow = { id: string; kind: string; severity: string; due_date: string | null; payload: Record<string, unknown> | null }

const fromAccess = (a: AccessView): Banner | null => { const n = accessNotice(a); return n ? { id: null, tone: n.tone, text: n.text, dismissible: false } : null }
const isKind = (k: string): k is NotificationKind => (NOTIFICATION_KINDS as readonly string[]).includes(k)

/**
 * - Bloqueado: siempre el aviso de bloqueo (explica por qué solo ve Suscripción).
 * - `rows === null` (no se pudieron leer/sincronizar los avisos): se usa el aviso calculado por la fase (etapa 6c), así el banner no desaparece por un error técnico.
 * - Si no: el aviso abierto de mayor prioridad.
 */
export function buildBanner(access: AccessView, rows: NotificationRow[] | null): Banner | null {
  if (access.locked || rows === null) return fromAccess(access)
  const known = rows.filter((r): r is NotificationRow & { kind: NotificationKind } => isKind(r.kind))
  const top = pickBanner(known)
  if (!top) return null
  const tone: Severity = top.severity === 'danger' || top.severity === 'warning' ? top.severity : 'info'
  return { id: top.id, tone, text: notificationText(top.kind, top.payload, top.due_date), dismissible: DISMISSIBLE_KINDS.includes(top.kind) }
}

// Política de suscripciones (aviso previo y gracia): lectura tolerante y validación estricta de lo que escribe el admin.
import { normalizeSettings, type PhaseSettings } from '@/lib/subscription-phase'

export const NOTICE_RANGE = { min: 1, max: 15 } as const
export const GRACE_RANGE = { min: 0, max: 30 } as const

/** Filas de app_settings -> configuración. Ausentes, inválidas o con error de lectura => valores iniciales. */
export function settingsFromRows(rows: unknown): PhaseSettings {
  const list = Array.isArray(rows) ? (rows as any[]) : []
  const get = (k: string) => list.find((r) => r && r.key === k)?.value
  return normalizeSettings({ noticeDays: get('notice_days'), graceDays: get('grace_days') })
}

export function parsePolicyForm(formData: FormData): { ok: true; value: PhaseSettings } | { ok: false; error: string } {
  const num = (k: string) => { const raw = String(formData.get(k) ?? '').trim(); return /^\d{1,3}$/.test(raw) ? Number(raw) : NaN }
  const noticeDays = num('notice_days'); const graceDays = num('grace_days')
  if (!(noticeDays >= NOTICE_RANGE.min && noticeDays <= NOTICE_RANGE.max)) return { ok: false, error: `El aviso previo debe ser un número entero entre ${NOTICE_RANGE.min} y ${NOTICE_RANGE.max} días.` }
  if (!(graceDays >= GRACE_RANGE.min && graceDays <= GRACE_RANGE.max)) return { ok: false, error: `El período de gracia debe ser un número entero entre ${GRACE_RANGE.min} y ${GRACE_RANGE.max} días.` }
  return { ok: true, value: { noticeDays, graceDays } }
}

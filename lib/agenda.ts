// Lógica pura de la agenda (sin React ni Supabase): se usa en cliente y servidor y se prueba sola.
// Las fechas son strings 'YYYY-MM-DD' y las horas 'HH:MM' en hora local del profesional.
// No se usa Date con zona horaria para guardar nada: así no hay corrimientos de día.

export const JOB_STATUSES = ['pending', 'scheduled', 'in_progress', 'done', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Pendiente de coordinación',
  scheduled: 'Programado',
  in_progress: 'En curso',
  done: 'Terminado',
  cancelled: 'Cancelado',
}

// Estados que exigen fecha (coincide con client_jobs_schedule_chk en la migración 0022).
export const STATUSES_NEED_DATE: JobStatus[] = ['scheduled', 'in_progress']
// Estados que siguen "vivos" en la agenda por defecto.
export const ACTIVE_STATUSES: JobStatus[] = ['pending', 'scheduled', 'in_progress']

export type AgendaJob = {
  id: string
  customer_id: string | null
  quote_id: string | null
  description: string
  job_date: string | null
  start_time: string | null // 'HH:MM' o 'HH:MM:SS' desde Postgres
  duration_minutes: number | null
  address: string | null
  notes: string | null
  status: JobStatus
  rescheduled_count: number
  cancel_reason: string | null
  created_at: string
  updated_at: string
  customers?: { id: string; name: string; phone: string | null } | null
}

export type JobInput = {
  customer_id: string | null
  quote_id: string | null
  description: string
  job_date: string | null
  start_time: string | null
  duration_minutes: number | null
  address: string | null
  notes: string | null
  status: JobStatus
}

export const DURATION_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 30, label: '30 minutos' },
  { minutes: 60, label: '1 hora' },
  { minutes: 90, label: '1 hora y media' },
  { minutes: 120, label: '2 horas' },
  { minutes: 180, label: '3 horas' },
  { minutes: 240, label: '4 horas (medio día)' },
  { minutes: 480, label: '8 horas (día completo)' },
]

export function isJobStatus(v: unknown): v is JobStatus {
  return typeof v === 'string' && (JOB_STATUSES as readonly string[]).includes(v)
}

// ---------------------------------------------------------------- fechas

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = DATE_RE.exec(s)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export function isValidTime(s: unknown): s is string {
  return typeof s === 'string' && TIME_RE.test(s)
}

/** 'HH:MM:SS' (Postgres) → 'HH:MM'. */
export function trimTime(t: string | null | undefined): string | null {
  if (!t) return null
  return t.slice(0, 5)
}

/** Hoy en hora LOCAL del dispositivo. Llamar solo en el cliente. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parse(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function fmt(dt: Date): string {
  return dt.toISOString().slice(0, 10)
}

export function addDays(s: string, n: number): string {
  const dt = parse(s)
  dt.setUTCDate(dt.getUTCDate() + n)
  return fmt(dt)
}

/** Lunes de la semana que contiene a `s`. */
export function startOfWeek(s: string): string {
  const dow = parse(s).getUTCDay() // 0 = domingo
  const back = dow === 0 ? 6 : dow - 1
  return addDays(s, -back)
}

export function weekDays(s: string): string[] {
  const start = startOfWeek(s)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function weekdayName(s: string): string {
  return WEEKDAYS[parse(s).getUTCDay()]
}
export function weekdayShort(s: string): string {
  return WEEKDAYS[parse(s).getUTCDay()].slice(0, 3)
}
export function dayNumber(s: string): number {
  return parse(s).getUTCDate()
}

/** "martes 13 de octubre" (+ año si no es el de `today`). */
export function formatDayLong(s: string, today?: string): string {
  const dt = parse(s)
  const base = `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} de ${MONTHS[dt.getUTCMonth()]}`
  return today && today.slice(0, 4) !== s.slice(0, 4) ? `${base} de ${dt.getUTCFullYear()}` : base
}

export function formatDayShort(s: string): string {
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

/** "Hoy", "Mañana", "Ayer" o el día largo. */
export function relativeDayLabel(s: string, today: string): string {
  if (s === today) return 'Hoy'
  if (s === addDays(today, 1)) return 'Mañana'
  if (s === addDays(today, -1)) return 'Ayer'
  const label = formatDayLong(s, today)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function formatWeekRange(start: string): string {
  const end = addDays(start, 6)
  const a = parse(start), b = parse(end)
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} al ${b.getUTCDate()} de ${MONTHS[b.getUTCMonth()]}`
  return `${a.getUTCDate()} de ${MONTHS[a.getUTCMonth()]} al ${b.getUTCDate()} de ${MONTHS[b.getUTCMonth()]}`
}

// ---------------------------------------------------------------- horarios

export function formatDuration(min: number | null | undefined): string {
  if (!min) return ''
  const h = Math.floor(min / 60), m = min % 60
  if (h === 0) return `${m} min`
  if (m === 0) return h === 1 ? '1 h' : `${h} h`
  return `${h} h ${m} min`
}

/** 'HH:MM' de fin, o null si no hay hora/duración o cruza la medianoche. */
export function endTime(start: string | null, duration: number | null): string | null {
  const s = trimTime(start)
  if (!s || !duration) return null
  const [h, m] = s.split(':').map(Number)
  const total = h * 60 + m + duration
  if (total >= 24 * 60) return null
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function formatTimeRange(start: string | null, duration: number | null): string {
  const s = trimTime(start)
  if (!s) return 'Sin horario'
  const e = endTime(s, duration)
  return e ? `${s} a ${e}` : s
}

// ---------------------------------------------------------------- orden y agrupado

/** Orden: fecha, luego hora (los sin hora al final del día), luego creación. */
export function compareJobs(a: AgendaJob, b: AgendaJob): number {
  const da = a.job_date ?? '9999-12-31', db = b.job_date ?? '9999-12-31'
  if (da !== db) return da < db ? -1 : 1
  const ta = trimTime(a.start_time) ?? '99:99', tb = trimTime(b.start_time) ?? '99:99'
  if (ta !== tb) return ta < tb ? -1 : 1
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
}

export function groupByDate(jobs: AgendaJob[]): { date: string; jobs: AgendaJob[] }[] {
  const map = new Map<string, AgendaJob[]>()
  for (const j of [...jobs].sort(compareJobs)) {
    if (!j.job_date) continue
    const arr = map.get(j.job_date)
    if (arr) arr.push(j)
    else map.set(j.job_date, [j])
  }
  return [...map.entries()].map(([date, js]) => ({ date, jobs: js }))
}

export function countByDate(jobs: AgendaJob[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const j of jobs) {
    if (j.job_date && ACTIVE_STATUSES.includes(j.status)) out[j.job_date] = (out[j.job_date] ?? 0) + 1
  }
  return out
}

// ---------------------------------------------------------------- validación

export const MAX_DESCRIPTION = 200
export const MAX_ADDRESS = 200
export const MAX_NOTES = 2000

/** Devuelve un mensaje en español o null si es válido. Se usa en el formulario y en el servidor. */
export function validateJobInput(i: JobInput): string | null {
  const description = (i.description ?? '').trim()
  if (!description) return 'Escribí una descripción del trabajo.'
  if (description.length > MAX_DESCRIPTION) return `La descripción puede tener hasta ${MAX_DESCRIPTION} caracteres.`
  if (!isJobStatus(i.status)) return 'El estado del trabajo no es válido.'
  if (i.job_date !== null && !isValidDate(i.job_date)) return 'La fecha no es válida.'
  if (i.start_time !== null && !isValidTime(i.start_time)) return 'El horario no es válido.'
  if (i.start_time !== null && i.job_date === null) return 'Para indicar un horario elegí también la fecha.'
  if (STATUSES_NEED_DATE.includes(i.status) && i.job_date === null) {
    return `Para dejar el trabajo en "${STATUS_LABEL[i.status]}" elegí una fecha, o cambialo a "${STATUS_LABEL.pending}".`
  }
  if (i.duration_minutes !== null) {
    if (!Number.isInteger(i.duration_minutes) || i.duration_minutes < 5 || i.duration_minutes > 1440) {
      return 'La duración estimada no es válida.'
    }
  }
  if (i.address !== null && i.address.length > MAX_ADDRESS) return `La dirección puede tener hasta ${MAX_ADDRESS} caracteres.`
  if (i.notes !== null && i.notes.length > MAX_NOTES) return `Las observaciones pueden tener hasta ${MAX_NOTES} caracteres.`
  return null
}

/** Normaliza strings vacíos a null y recorta espacios. No valida. */
export function normalizeJobInput(i: JobInput): JobInput {
  const t = (s: string | null) => (s == null ? null : s.trim() || null)
  return {
    ...i,
    description: (i.description ?? '').trim(),
    address: t(i.address),
    notes: t(i.notes),
    job_date: i.job_date || null,
    start_time: i.start_time ? i.start_time.slice(0, 5) : null,
  }
}

/** ¿Cambió la programación (fecha u hora) de un trabajo que ya tenía fecha? Cuenta como reprogramación. */
export function isReschedule(
  before: { job_date: string | null; start_time: string | null },
  after: { job_date: string | null; start_time: string | null },
): boolean {
  if (before.job_date === null) return false // primera programación, no reprogramación
  return before.job_date !== after.job_date || trimTime(before.start_time) !== trimTime(after.start_time)
}

export function describeSlot(job_date: string | null, start_time: string | null): string {
  if (!job_date) return 'sin fecha'
  const t = trimTime(start_time)
  return t ? `${formatDayShort(job_date)} ${t}` : formatDayShort(job_date)
}

/** Descripción de un trabajo creado desde un presupuesto: ítems del presupuesto, recortada. */
export function buildQuoteJobDescription(
  items: { description: string; quantity: number }[],
  quoteNumber: number | null,
): string {
  const parts = items
    .filter((it) => it.description?.trim())
    .map((it) => (Number(it.quantity) > 1 ? `${it.description.trim()} (x${Number(it.quantity)})` : it.description.trim()))
  if (parts.length === 0) return `Presupuesto Nº ${String(quoteNumber ?? '?').padStart(5, '0')}`
  const full = parts.join(', ')
  return full.length <= MAX_DESCRIPTION ? full : `${full.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`
}

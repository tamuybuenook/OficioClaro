'use server'

import { createClient } from '@/lib/supabase/server'
import { requireFullAccess } from '@/lib/services/access'
import {
  STATUS_LABEL, STATUSES_NEED_DATE, buildQuoteJobDescription, describeSlot,
  isJobStatus, isReschedule, normalizeJobInput, validateJobInput,
  type AgendaJob, type JobInput, type JobStatus,
} from '@/lib/agenda'

// Todas las consultas filtran por user_id de forma explícita: la RLS de client_jobs deja pasar al
// admin a todas las filas y la agenda de un profesional nunca debe mezclar trabajos ajenos.

const JOB_COLUMNS =
  'id, customer_id, quote_id, description, job_date, start_time, duration_minutes, address, notes, status, rescheduled_count, cancel_reason, created_at, updated_at, customers(id, name, phone)'

const MIGRATION_PENDING =
  'La agenda necesita una actualización de la base de datos que todavía no se aplicó. Avisá a soporte; no se guardó nada.'
const GENERIC_SAVE_ERROR = 'No se pudo guardar. Revisá tu conexión e intentá de nuevo.'

type PgError = { message: string; code?: string }
type Result<T> = { data: T; error?: undefined } | { error: string; data?: undefined }

// Traduce errores de Postgres a mensajes entendibles sin exponer detalles internos.
function friendlyError(e: PgError, duplicateMessage?: string): string {
  if (e.code === '42703' || e.code === 'PGRST204' || e.code === 'PGRST200') return MIGRATION_PENDING
  if (e.code === '23505') return duplicateMessage ?? 'Ese trabajo ya existe.'
  if (e.code === '23514') return 'Los datos del trabajo no son válidos (revisá fecha, horario y estado).'
  if (e.code === 'P0001') return e.message // mensajes en español definidos en client_jobs_guard()
  return GENERIC_SAVE_ERROR
}

async function getUserAndClient() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

async function logActivity(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, customerId: string | null, type: string, description: string) {
  if (!customerId) return
  // El historial es informativo: si falla no se revierte el trabajo.
  await supabase.from('client_activity').insert({ user_id: userId, customer_id: customerId, type, description })
}

// ----------------------------------------------------------------------------- lectura

export async function fetchAgenda(from: string, to: string, today: string): Promise<Result<{ jobs: AgendaJob[]; unscheduled: AgendaJob[]; overdue: AgendaJob[] }>> {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const { supabase, user } = await getUserAndClient()
  if (!user) return { error: 'No autenticado' }

  const [range, unscheduled, overdue] = await Promise.all([
    supabase.from('client_jobs').select(JOB_COLUMNS).eq('user_id', user.id).gte('job_date', from).lte('job_date', to).order('job_date').order('start_time', { nullsFirst: false }),
    supabase.from('client_jobs').select(JOB_COLUMNS).eq('user_id', user.id).is('job_date', null).order('created_at', { ascending: false }).limit(100),
    supabase.from('client_jobs').select(JOB_COLUMNS).eq('user_id', user.id).lt('job_date', today).in('status', ['scheduled', 'in_progress']).order('job_date', { ascending: false }).limit(50),
  ])
  const failed = range.error ?? unscheduled.error ?? overdue.error
  if (failed) return { error: friendlyError(failed) === GENERIC_SAVE_ERROR ? 'No se pudo cargar la agenda. Revisá tu conexión e intentá de nuevo.' : friendlyError(failed) }
  return {
    data: {
      jobs: (range.data ?? []) as unknown as AgendaJob[],
      unscheduled: (unscheduled.data ?? []) as unknown as AgendaJob[],
      overdue: (overdue.data ?? []) as unknown as AgendaJob[],
    },
  }
}

export async function fetchAgendaCustomers(): Promise<Result<{ id: string; name: string; phone: string | null; address: string | null }[]>> {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const { supabase, user } = await getUserAndClient()
  if (!user) return { error: 'No autenticado' }
  const { data, error } = await supabase.from('customers').select('id, name, phone, address').eq('user_id', user.id).order('name')
  if (error) return { error: 'No se pudieron cargar tus clientes.' }
  return { data: data ?? [] }
}

export async function fetchAgendaJob(id: string): Promise<Result<AgendaJob>> {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const { supabase, user } = await getUserAndClient()
  if (!user) return { error: 'No autenticado' }
  const { data, error } = await supabase.from('client_jobs').select(JOB_COLUMNS).eq('id', id).eq('user_id', user.id).maybeSingle()
  if (error) return { error: friendlyError(error) === GENERIC_SAVE_ERROR ? 'No se pudo cargar el trabajo.' : friendlyError(error) }
  if (!data) return { error: 'No encontramos ese trabajo.' }
  return { data: data as unknown as AgendaJob }
}

async function findActiveJobForQuote(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, quoteId: string) {
  const { data } = await supabase.from('client_jobs').select(JOB_COLUMNS).eq('user_id', userId).eq('quote_id', quoteId).neq('status', 'cancelled').maybeSingle()
  return (data as unknown as AgendaJob | null) ?? null
}

/** Trabajo activo vinculado a un presupuesto (para mostrar "Ver en agenda" en vez de "Programar"). */
export async function fetchJobForQuote(quoteId: string): Promise<Result<AgendaJob | null>> {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const { supabase, user } = await getUserAndClient()
  if (!user) return { error: 'No autenticado' }
  return { data: await findActiveJobForQuote(supabase, user.id, quoteId) }
}

export type QuoteScheduleDraft = {
  quote: { id: string; number: number | null; customer_id: string | null; customer_name: string | null }
  prefill: { description: string; address: string | null; notes: string | null }
  existing: AgendaJob | null
}

/** Datos del presupuesto aceptado para precargar el formulario. NO crea nada. */
export async function fetchQuoteScheduleDraft(quoteId: string): Promise<Result<QuoteScheduleDraft>> {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const { supabase, user } = await getUserAndClient()
  if (!user) return { error: 'No autenticado' }

  const { data: quote, error } = await supabase
    .from('quotes').select('id, number, status, notes, customer_id, customers(name, address)')
    .eq('id', quoteId).eq('user_id', user.id).maybeSingle()
  if (error) return { error: 'No se pudo cargar el presupuesto.' }
  if (!quote) return { error: 'No encontramos ese presupuesto.' }
  if (quote.status !== 'accepted') return { error: 'Solo se puede programar un trabajo desde un presupuesto aceptado.' }

  const existing = await findActiveJobForQuote(supabase, user.id, quoteId)

  // select('*') + services(name): funciona con y sin la columna quote_items.description (migración 0022).
  const { data: items, error: itemsError } = await supabase.from('quote_items').select('*, services(name)').eq('quote_id', quoteId)
  if (itemsError) return { error: 'No se pudieron cargar los ítems del presupuesto.' }

  const customer = (quote as any).customers as { name: string; address: string | null } | null
  const description = buildQuoteJobDescription(
    (items ?? []).map((it: any) => ({ description: it.description ?? it.services?.name ?? '', quantity: Number(it.quantity) })),
    quote.number,
  )
  return {
    data: {
      quote: { id: quote.id, number: quote.number, customer_id: quote.customer_id, customer_name: customer?.name ?? null },
      prefill: { description, address: customer?.address ?? null, notes: quote.notes ?? null },
      existing,
    },
  }
}

// ----------------------------------------------------------------------------- escritura

async function customerBelongsToUser(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, customerId: string) {
  const { data } = await supabase.from('customers').select('id').eq('id', customerId).eq('user_id', userId).maybeSingle()
  return !!data
}

export async function createAgendaJob(raw: JobInput): Promise<Result<AgendaJob> & { duplicate?: boolean }> {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const { supabase, user } = await getUserAndClient()
  if (!user) return { error: 'No autenticado' }

  const input = normalizeJobInput(raw)
  let customerId = input.customer_id
  const quoteId = input.quote_id

  if (quoteId) {
    const { data: quote } = await supabase.from('quotes').select('id, status, customer_id').eq('id', quoteId).eq('user_id', user.id).maybeSingle()
    if (!quote) return { error: 'No encontramos ese presupuesto.' }
    if (quote.status !== 'accepted') return { error: 'Solo se puede programar un trabajo desde un presupuesto aceptado.' }
    // El cliente siempre es el del presupuesto: ignora lo que haya enviado el navegador.
    customerId = quote.customer_id
    // Repetir la operación no duplica: se devuelve el trabajo que ya existe.
    const existing = await findActiveJobForQuote(supabase, user.id, quoteId)
    if (existing) return { data: existing, duplicate: true }
  } else if (customerId && !(await customerBelongsToUser(supabase, user.id, customerId))) {
    return { error: 'No encontramos ese cliente.' }
  }

  const clean: JobInput = { ...input, customer_id: customerId }
  const invalid = validateJobInput(clean)
  if (invalid) return { error: invalid }

  const { data, error } = await supabase.from('client_jobs').insert({
    user_id: user.id,
    customer_id: clean.customer_id,
    quote_id: clean.quote_id,
    description: clean.description,
    job_date: clean.job_date,
    start_time: clean.start_time,
    duration_minutes: clean.duration_minutes,
    address: clean.address,
    notes: clean.notes,
    status: clean.status,
  }).select(JOB_COLUMNS).single()

  if (error) {
    // Dos envíos simultáneos: gana uno y el otro recibe el existente (índice único por presupuesto).
    if (error.code === '23505' && quoteId) {
      const existing = await findActiveJobForQuote(supabase, user.id, quoteId)
      if (existing) return { data: existing, duplicate: true }
    }
    return { error: friendlyError(error, 'Este presupuesto ya tiene un trabajo agendado.') }
  }

  await logActivity(supabase, user.id, clean.customer_id, 'trabajo_programado', `${clean.description} · ${describeSlot(clean.job_date, clean.start_time)}`)
  return { data: data as unknown as AgendaJob }
}

export async function updateAgendaJob(id: string, raw: JobInput): Promise<Result<AgendaJob>> {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const { supabase, user } = await getUserAndClient()
  if (!user) return { error: 'No autenticado' }

  const { data: before } = await supabase.from('client_jobs').select(JOB_COLUMNS).eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!before) return { error: 'No encontramos ese trabajo.' }
  const prev = before as unknown as AgendaJob

  const input = normalizeJobInput(raw)
  // Un trabajo nacido de un presupuesto conserva su presupuesto y su cliente: no se pueden cambiar.
  const customerId = prev.quote_id ? prev.customer_id : input.customer_id
  if (!prev.quote_id && customerId && customerId !== prev.customer_id && !(await customerBelongsToUser(supabase, user.id, customerId))) {
    return { error: 'No encontramos ese cliente.' }
  }
  const clean: JobInput = { ...input, customer_id: customerId, quote_id: prev.quote_id }
  const invalid = validateJobInput(clean)
  if (invalid) return { error: invalid }

  const rescheduled = isReschedule(prev, clean)
  const statusChanged = prev.status !== clean.status

  const { data, error } = await supabase.from('client_jobs').update({
    customer_id: clean.customer_id,
    description: clean.description,
    job_date: clean.job_date,
    start_time: clean.start_time,
    duration_minutes: clean.duration_minutes,
    address: clean.address,
    notes: clean.notes,
    status: clean.status,
    cancel_reason: clean.status === 'cancelled' ? prev.cancel_reason : null,
    rescheduled_count: prev.rescheduled_count + (rescheduled ? 1 : 0),
  }).eq('id', id).eq('user_id', user.id).select(JOB_COLUMNS).single()
  if (error) return { error: friendlyError(error, 'Este presupuesto ya tiene otro trabajo activo.') }

  if (rescheduled) {
    await logActivity(supabase, user.id, clean.customer_id, 'trabajo_reprogramado', `${clean.description} · de ${describeSlot(prev.job_date, prev.start_time)} a ${describeSlot(clean.job_date, clean.start_time)}`)
  }
  if (statusChanged) {
    await logActivity(supabase, user.id, clean.customer_id, 'trabajo_estado', `${clean.description} · ${STATUS_LABEL[clean.status]}`)
  }
  return { data: data as unknown as AgendaJob }
}

export async function setAgendaJobStatus(id: string, status: JobStatus, reason?: string | null): Promise<Result<AgendaJob>> {
  const denied = await requireFullAccess()
  if (denied) return { error: denied.error }
  const { supabase, user } = await getUserAndClient()
  if (!user) return { error: 'No autenticado' }
  if (!isJobStatus(status)) return { error: 'El estado del trabajo no es válido.' }

  const { data: before } = await supabase.from('client_jobs').select(JOB_COLUMNS).eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!before) return { error: 'No encontramos ese trabajo.' }
  const prev = before as unknown as AgendaJob
  if (prev.status === status) return { data: prev }
  if (STATUSES_NEED_DATE.includes(status) && !prev.job_date) {
    return { error: `Para pasarlo a "${STATUS_LABEL[status]}" primero elegí una fecha (botón Editar).` }
  }

  const cancelReason = status === 'cancelled' ? (reason?.trim().slice(0, 500) || null) : null
  const { data, error } = await supabase.from('client_jobs')
    .update({ status, cancel_reason: cancelReason })
    .eq('id', id).eq('user_id', user.id).select(JOB_COLUMNS).single()
  if (error) return { error: friendlyError(error, 'Este presupuesto ya tiene otro trabajo activo.') }

  const detail = status === 'cancelled' && cancelReason ? ` (${cancelReason})` : ''
  await logActivity(supabase, user.id, prev.customer_id, status === 'cancelled' ? 'trabajo_cancelado' : 'trabajo_estado', `${prev.description} · ${STATUS_LABEL[status]}${detail}`)
  return { data: data as unknown as AgendaJob }
}

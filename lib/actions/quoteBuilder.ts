'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireFullAccess } from '@/lib/services/access'
import { getMyEnabledTradeIds } from '@/lib/services/userTrades'
import { getPricingBatch } from '@/lib/services/pricingBatch'
import {
  hasErrors, likeEscape, searchWords, toPayload, validateQuote,
  type Concept, type ConceptPage, type CustomerOption, type QuoteForEdit, type QuoteLine, type QuoteStatus, type SaveQuoteResult,
} from '@/lib/quotes'

// Acciones del formulario único de presupuestos (lo usan Clientes y Agenda).
// Autorización: siempre en el servidor (sesión + RLS de la base). Nada de lo que llega del navegador
// decide la propiedad: user_id sale de la sesión y save_quote() lo toma de auth.uid().

const CONCEPT_PAGE = 20
const GENERIC = 'No se pudo completar la operación. Revisá tu conexión e intentá de nuevo.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Ctx = { ok: false; error: string } | { ok: true; supabase: SupabaseClient; user: { id: string } }

async function ctx(): Promise<Ctx> {
  const denied = await requireFullAccess()
  if (denied) return { ok: false, error: denied.error }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado' }
  return { ok: true, supabase: supabase as unknown as SupabaseClient, user }
}

// ------------------------------------------------------------------ búsquedas (en el servidor, paginadas)

export async function searchCustomers(q: string): Promise<{ data: CustomerOption[] } | { error: string }> {
  const c = await ctx()
  if (!c.ok) return { error: c.error }
  let b = c.supabase.from('customers').select('id, name, phone, address').eq('user_id', c.user.id).order('name').limit(20)
  for (const w of searchWords(q)) {
    const e = likeEscape(w)
    b = b.or(`name.ilike.%${e}%,phone.ilike.%${e}%`)
  }
  const { data, error } = await b
  if (error) return { error: 'No se pudieron cargar tus clientes.' }
  return { data: (data ?? []) as CustomerOption[] }
}

export async function fetchCustomerById(id: string): Promise<{ data: CustomerOption | null } | { error: string }> {
  const c = await ctx()
  if (!c.ok) return { error: c.error }
  const { data, error } = await c.supabase.from('customers').select('id, name, phone, address').eq('id', id).eq('user_id', c.user.id).maybeSingle()
  if (error) return { error: 'No se pudo cargar el cliente.' }
  return { data: (data as CustomerOption | null) ?? null }
}

export async function searchConcepts(params: { scope: 'own' | 'service'; q: string; page?: number }): Promise<ConceptPage | { error: string }> {
  const c = await ctx()
  if (!c.ok) return { error: c.error }
  const page = Math.max(1, Math.floor(params.page ?? 1) || 1)
  const from = (page - 1) * CONCEPT_PAGE
  const to = from + CONCEPT_PAGE - 1
  const words = searchWords(params.q)

  if (params.scope === 'own') {
    let b = c.supabase.from('catalog_items')
      .select('id, name, description, category, unit_label, unit_price', { count: 'exact' })
      .eq('user_id', c.user.id).eq('is_active', true).order('name').range(from, to)
    for (const w of words) { const e = likeEscape(w); b = b.or(`name.ilike.%${e}%,category.ilike.%${e}%`) }
    const { data, count, error } = await b
    if (error) return { error: 'No se pudo cargar tu catálogo.' }
    const items: Concept[] = (data ?? []).map((r: any) => ({ kind: 'own', id: r.id, name: r.name, description: r.description, category: r.category, unit: r.unit_label, price: Number(r.unit_price) }))
    return { items, total: count ?? 0, page, pageSize: CONCEPT_PAGE }
  }

  const tradeIds = await getMyEnabledTradeIds(c.user.id).catch(() => [] as string[])
  if (tradeIds.length === 0) return { items: [], total: 0, page, pageSize: CONCEPT_PAGE }
  let b = c.supabase.from('services')
    .select('id, name, unit_label, categories!inner(name, trade_id)', { count: 'exact' })
    .in('categories.trade_id', tradeIds).order('name').range(from, to)
  for (const w of words) b = b.ilike('name', `%${likeEscape(w)}%`)
  const { data, count, error } = await b
  if (error) return { error: 'No se pudo cargar la lista de precios.' }
  const pricing = await getPricingBatch(c.supabase, c.user.id, (data ?? []).map((s: any) => s.id))
  const items: Concept[] = (data ?? []).flatMap((s: any) => {
    const p = pricing.get(s.id)
    const cat = Array.isArray(s.categories) ? s.categories[0] : s.categories
    return p ? [{ kind: 'service' as const, id: s.id, name: s.name, description: null, category: cat?.name ?? null, unit: s.unit_label, price: p.personalPrice }] : []
  })
  return { items, total: count ?? 0, page, pageSize: CONCEPT_PAGE }
}

// ------------------------------------------------------------------ lectura de un presupuesto para editarlo

export async function fetchQuoteForEdit(quoteId: string): Promise<{ data: QuoteForEdit } | { error: string }> {
  const c = await ctx()
  if (!c.ok) return { error: c.error }
  const { data: q, error } = await c.supabase.from('quotes')
    .select('id, number, status, notes, total, created_at, customers(id, name, phone, address)')
    .eq('id', quoteId).eq('user_id', c.user.id).maybeSingle()
  if (error) return { error: 'No se pudo cargar el presupuesto.' }
  if (!q) return { error: 'No encontramos ese presupuesto.' }

  const [itemsRes, jobRes] = await Promise.all([
    c.supabase.from('quote_items').select('id, service_id, catalog_item_id, description, unit_label, quantity, unit_price, position, services(name, unit_label)').eq('quote_id', quoteId).order('position').order('id'),
    c.supabase.from('client_jobs').select('id, description, status').eq('user_id', c.user.id).eq('quote_id', quoteId).neq('status', 'cancelled').maybeSingle(),
  ])
  if (itemsRes.error) return { error: 'No se pudieron cargar los ítems del presupuesto.' }

  const customer = Array.isArray((q as any).customers) ? (q as any).customers[0] : (q as any).customers
  const lines: QuoteLine[] = (itemsRes.data ?? []).map((r: any) => {
    const svc = Array.isArray(r.services) ? r.services[0] : r.services
    return {
      key: r.id,
      source: r.service_id ? 'service' : r.catalog_item_id ? 'own' : 'custom',
      serviceId: r.service_id ?? null,
      catalogItemId: r.catalog_item_id ?? null,
      description: r.description ?? svc?.name ?? '',
      unitLabel: r.unit_label ?? svc?.unit_label ?? null,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unit_price),
    }
  })
  return {
    data: {
      id: q.id, number: q.number ?? null, status: q.status as QuoteStatus, notes: q.notes ?? null, total: Number(q.total), created_at: q.created_at,
      customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone ?? null, address: customer.address ?? null } : null,
      lines,
      job: (jobRes.data as any) ?? null,
    },
  }
}

// ------------------------------------------------------------------ guardado

export async function saveQuote(input: {
  requestId: string; quoteId: string | null; customerId: string | null; notes: string; lines: QuoteLine[]; jobId?: string | null
}): Promise<SaveQuoteResult> {
  const c = await ctx()
  if (!c.ok) return { error: c.error }

  if (!UUID.test(input.requestId)) return { error: 'Solicitud inválida. Recargá la página e intentá de nuevo.' }
  const lines = Array.isArray(input.lines) ? input.lines : []
  const notes = typeof input.notes === 'string' ? input.notes : ''
  const check = validateQuote(lines, notes)
  if (hasErrors(check)) return { error: check.form ?? 'Revisá las líneas marcadas.', fieldErrors: check.lines }

  // Los totales NO viajan: los calcula save_quote() en la base con la misma regla que la vista previa.
  const { data, error } = await c.supabase.rpc('save_quote', {
    p_request_id: input.requestId,
    p_quote_id: input.quoteId,
    p_customer_id: input.customerId,
    p_notes: notes,
    p_items: toPayload(lines),
  })
  if (error) {
    if (error.code === 'P0001') return { error: error.message }               // mensajes en español definidos en la base
    if (error.code === 'PGRST202' || error.code === '42883') return { error: 'Los presupuestos necesitan una actualización de la base de datos que todavía no se aplicó. Avisá a soporte; no se guardó nada.' }
    console.error('[saveQuote]', error.code ?? 'sin_codigo')
    return { error: GENERIC }
  }
  const r = data as { id: string; number: number; total: number; created: boolean }

  if (r.created && input.customerId) {
    // Historial del cliente: informativo, no revierte el guardado si falla.
    await c.supabase.from('client_activity').insert({ user_id: c.user.id, customer_id: input.customerId, type: 'presupuesto_creado', description: `Presupuesto Nº ${String(r.number).padStart(5, '0')}` })
  }

  let linked = false
  let linkError: string | undefined
  if (input.jobId) {
    const res = await linkInternal(c.supabase, c.user.id, input.jobId, r.id)
    linked = res.ok
    linkError = res.error
  }
  return { data: { id: r.id, number: r.number, total: Number(r.total), created: r.created, linked, linkError } }
}

// ------------------------------------------------------------------ vínculo con la agenda

async function linkInternal(supabase: SupabaseClient, userId: string, jobId: string, quoteId: string): Promise<{ ok: boolean; error?: string }> {
  const [{ data: job }, { data: quote }] = await Promise.all([
    supabase.from('client_jobs').select('id, customer_id, quote_id, status').eq('id', jobId).eq('user_id', userId).maybeSingle(),
    supabase.from('quotes').select('id, customer_id').eq('id', quoteId).eq('user_id', userId).maybeSingle(),
  ])
  if (!job) return { ok: false, error: 'No encontramos ese trabajo en tu agenda.' }
  if (!quote) return { ok: false, error: 'No encontramos ese presupuesto.' }
  if (job.quote_id === quoteId) return { ok: true }                                    // reintento: ya estaba vinculado
  if (job.quote_id) return { ok: false, error: 'Este trabajo ya tiene otro presupuesto vinculado.' }
  if (job.status === 'cancelled') return { ok: false, error: 'No se puede vincular un presupuesto a un trabajo cancelado.' }
  if (job.customer_id && quote.customer_id && job.customer_id !== quote.customer_id) {
    return { ok: false, error: 'El cliente del presupuesto no coincide con el del trabajo.' }
  }
  if (job.customer_id && !quote.customer_id) return { ok: false, error: 'Elegí el cliente del trabajo en el presupuesto para poder vincularlos.' }

  // Un solo UPDATE: el trabajo adopta el cliente del presupuesto si no tenía (el trigger exige que coincidan).
  const { error } = await supabase.from('client_jobs').update({ quote_id: quoteId, customer_id: quote.customer_id ?? job.customer_id }).eq('id', jobId).eq('user_id', userId)
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Este presupuesto ya está vinculado a otro trabajo de la agenda.' }
    if (error.code === 'P0001') return { ok: false, error: error.message }
    return { ok: false, error: 'No se pudo vincular el presupuesto con el trabajo.' }
  }
  return { ok: true }
}

export async function linkQuoteToJob(jobId: string, quoteId: string): Promise<{ ok: true } | { error: string }> {
  const c = await ctx()
  if (!c.ok) return { error: c.error }
  const r = await linkInternal(c.supabase, c.user.id, jobId, quoteId)
  return r.ok ? { ok: true } : { error: r.error ?? GENERIC }
}

export type LinkableQuote = { id: string; number: number | null; status: string; total: number; customerName: string | null }

/** Presupuestos del profesional que todavía no tienen trabajo activo (para vincular desde la agenda). */
export async function fetchLinkableQuotes(customerId: string | null): Promise<{ data: LinkableQuote[] } | { error: string }> {
  const c = await ctx()
  if (!c.ok) return { error: c.error }
  let b = c.supabase.from('quotes').select('id, number, status, total, customer_id, customers(name)').eq('user_id', c.user.id).order('created_at', { ascending: false }).limit(40)
  if (customerId) b = b.eq('customer_id', customerId)
  const { data, error } = await b
  if (error) return { error: 'No se pudieron cargar tus presupuestos.' }
  const ids = (data ?? []).map((q: any) => q.id)
  const { data: used } = ids.length
    ? await c.supabase.from('client_jobs').select('quote_id').eq('user_id', c.user.id).in('quote_id', ids).neq('status', 'cancelled')
    : { data: [] as any[] }
  const taken = new Set((used ?? []).map((j: any) => j.quote_id))
  return {
    data: (data ?? []).filter((q: any) => !taken.has(q.id)).map((q: any) => {
      const cust = Array.isArray(q.customers) ? q.customers[0] : q.customers
      return { id: q.id, number: q.number, status: q.status, total: Number(q.total), customerName: cust?.name ?? null }
    }),
  }
}

/** Vuelve a borrador un presupuesto enviado o rechazado para poder corregirlo. Un presupuesto aceptado no se reabre. */
export async function reopenQuote(quoteId: string): Promise<{ ok: true } | { error: string }> {
  const c = await ctx()
  if (!c.ok) return { error: c.error }
  const { data, error } = await c.supabase.from('quotes').update({ status: 'draft' }).eq('id', quoteId).eq('user_id', c.user.id).in('status', ['sent', 'rejected']).select('id')
  if (error) return { error: GENERIC }
  if (!data || data.length === 0) return { error: 'Este presupuesto no se puede reabrir (solo los enviados o rechazados).' }
  return { ok: true }
}

// ------------------------------------------------------------------ sello de sincronización (para la caché de cada dispositivo)

export async function fetchSyncStamp(): Promise<{ data: Record<string, string | null> } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { data, error } = await supabase.rpc('my_sync_stamp')
  if (error) return { error: GENERIC }
  return { data: data as Record<string, string | null> }
}

// ------------------------------------------------------------------ lista de presupuestos (paginada)

export type QuoteListRow = { id: string; number: number | null; status: string; total: number; created_at: string; customerName: string | null }
const QUOTE_PAGE = 25

export async function fetchQuoteList(page = 1): Promise<{ items: QuoteListRow[]; total: number; page: number; pageSize: number } | { error: string }> {
  const c = await ctx()
  if (!c.ok) return { error: c.error }
  const p = Math.max(1, Math.floor(page) || 1)
  const from = (p - 1) * QUOTE_PAGE
  const { data, count, error } = await c.supabase.from('quotes')
    .select('id, number, status, total, created_at, customers(name)', { count: 'exact' })
    .eq('user_id', c.user.id).order('created_at', { ascending: false }).range(from, from + QUOTE_PAGE - 1)
  if (error) return { error: 'No se pudieron cargar tus presupuestos.' }
  return {
    items: (data ?? []).map((q: any) => {
      const cust = Array.isArray(q.customers) ? q.customers[0] : q.customers
      return { id: q.id, number: q.number, status: q.status, total: Number(q.total), created_at: q.created_at, customerName: cust?.name ?? null }
    }),
    total: count ?? 0, page: p, pageSize: QUOTE_PAGE,
  }
}

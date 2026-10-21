// Consultas de solo lectura del panel de facturación. Se ejecutan con el cliente de la SESIÓN del admin
// (RLS: is_admin()), nunca con service_role. Ninguna escribe. Todo se pagina o se agrega en trozos acotados.
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyCategoryFilter, summarizePayments, type Category, type PaymentsSummary, type SummaryRow } from './classify'
import { PAGE_SIZE, type BillingFilters } from './filters'
import { displayState, todayAR as todayArSub } from '@/lib/subscription-access'

type Db = SupabaseClient
const CHUNK = 1000
export const SCAN_CAP = 20_000   // tope de filas leídas por agregado; si se alcanza, el panel avisa "parcial"

export const PAYMENT_COLS =
  'id, created_at, updated_at, amount, provider, status, external_id, reference, proof_url, mp_status, mp_status_detail, applied_at, review_reason, review_resolution, reviewed_at, reviewed_by, plan_id, subscription_id'

function fail(error: { message: string } | null, what: string): void { if (error) throw new Error(`${what}: ${error.message}`) }

/** Lee una consulta en trozos de 1000 (range) hasta agotar o llegar al tope. */
async function scan<T>(make: () => any, cap = SCAN_CAP): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  for (let from = 0; from < cap; from += CHUNK) {
    const { data, error } = await make().range(from, from + CHUNK - 1)
    fail(error, 'consulta')
    const chunk = (data ?? []) as T[]
    rows.push(...chunk)
    if (chunk.length < CHUNK) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

// ---------------- Resumen ----------------
export async function fetchPaymentsSummary(db: Db, f: Pick<BillingFilters, 'range'>): Promise<{ summary: PaymentsSummary; truncated: boolean }> {
  const { rows, truncated } = await scan<SummaryRow>(() => {
    let q = db.from('payments').select('provider, status, applied_at, review_reason, review_resolution, external_id, amount').order('created_at', { ascending: false }).order('id')
    if (f.range.fromIso) q = q.gte('created_at', f.range.fromIso)
    if (f.range.toIso) q = q.lt('created_at', f.range.toIso)
    return q
  })
  return { summary: summarizePayments(rows), truncated }
}

export type SubscriptionSummary = {
  users: number; trial: number; active: number; past_due: number; cancelled_with_access: number; suspended: number; expired: number
  auto_renew: number   // con autorización recurrente vigente (mp_status = 'authorized') y acceso
  none_with_mp_auth_but_no_access: number
}
type SubFacts = { user_id: string; status: string; end_date: string | null; mp_status: string | null }

/** Una fila por usuario: su suscripción más reciente (la vigente). */
export function summarizeSubscriptions(rowsNewestFirst: SubFacts[], today = todayArSub()): SubscriptionSummary {
  const seen = new Set<string>()
  const s: SubscriptionSummary = { users: 0, trial: 0, active: 0, past_due: 0, cancelled_with_access: 0, suspended: 0, expired: 0, auto_renew: 0, none_with_mp_auth_but_no_access: 0 }
  for (const r of rowsNewestFirst) {
    if (seen.has(r.user_id)) continue
    seen.add(r.user_id); s.users += 1
    const st = displayState(r, today)
    if (st === 'trial') s.trial += 1
    else if (st === 'active') s.active += 1
    else if (st === 'past_due') s.past_due += 1
    else if (st === 'cancelled') s.cancelled_with_access += 1
    else if (st === 'suspended') s.suspended += 1
    else if (st === 'expired') s.expired += 1
    const access = st === 'trial' || st === 'active' || st === 'past_due'
    if (r.mp_status === 'authorized') { if (access) s.auto_renew += 1; else s.none_with_mp_auth_but_no_access += 1 }
  }
  return s
}

export async function fetchSubscriptionsSummary(db: Db): Promise<{ summary: SubscriptionSummary; truncated: boolean }> {
  const { rows, truncated } = await scan<SubFacts>(() => db.from('subscriptions').select('user_id, status, end_date, mp_status').order('created_at', { ascending: false }).order('id'))
  return { summary: summarizeSubscriptions(rows), truncated }
}

// ---------------- Listado de pagos ----------------
export type PaymentListRow = {
  id: string; created_at: string; amount: number; provider: string; status: string; external_id: string | null; reference: string | null
  mp_status: string | null; mp_status_detail: string | null; applied_at: string | null; review_reason: string | null; review_resolution: string | null
  plan_id: string | null; subscription_id: string
  plans: { name: string; billing_period: string } | null
  subscriptions: { user_id: string; status: string; end_date: string | null; profiles: { full_name: string | null } | null } | null
  covered_until: string | null
}

const LIST_SELECT = `${PAYMENT_COLS}, plans(name, billing_period), subscriptions(user_id, status, end_date, profiles(full_name))`

/** Ids de suscripción que coinciden con un texto (nombre del usuario) o con un user_id. Acotado. */
export async function findSubscriptionIdsByUserText(db: Db, f: Pick<BillingFilters, 'q' | 'qKind'>): Promise<string[]> {
  let userIds: string[] = []
  if (f.qKind === 'uuid') userIds = [f.q]
  else if (f.qKind === 'text') {
    const { data, error } = await db.from('profiles').select('id').ilike('full_name', `%${f.q}%`).limit(50)
    fail(error, 'perfiles'); userIds = (data ?? []).map((p: any) => p.id)
  }
  if (!userIds.length) return []
  const { data, error } = await db.from('subscriptions').select('id').in('user_id', userIds).limit(200)
  fail(error, 'suscripciones')
  return (data ?? []).map((s: any) => s.id)
}

/** Aplica rango, proveedor, estado y búsqueda. Exportada para probar la composición. */
export function applyPaymentFilters(q: any, f: BillingFilters, subIds: string[]): any {
  if (f.range.fromIso) q = q.gte('created_at', f.range.fromIso)
  if (f.range.toIso) q = q.lt('created_at', f.range.toIso)
  if (f.provider) q = q.eq('provider', f.provider)
  if (f.status) q = applyCategoryFilter(q, f.status as Category)
  if (f.qKind === 'uuid') {
    const parts = [`id.eq.${f.q}`, `subscription_id.eq.${f.q}`]
    if (subIds.length) parts.push(`subscription_id.in.(${subIds.join(',')})`)
    q = q.or(parts.join(','))
  } else if (f.qKind === 'text') {
    const parts = [`external_id.ilike.%${f.q}%`, `reference.ilike.%${f.q}%`]
    if (subIds.length) parts.push(`subscription_id.in.(${subIds.join(',')})`)
    q = q.or(parts.join(','))
  }
  return q
}

const END_DATE_ACTIONS = ['mp_approved', 'reconcile', 'held_payment_apply']

/** Fecha hasta la que quedó cubierto el período, leída de la auditoría del propio pago (no se recalcula). */
export async function fetchCoveredUntil(db: Db, paymentIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!paymentIds.length) return out
  const { data, error } = await db.from('audit_logs').select('entity_id, action, new_value, created_at')
    .eq('entity', 'payments').in('entity_id', paymentIds).in('action', END_DATE_ACTIONS).order('created_at', { ascending: false })
  fail(error, 'auditoría')
  for (const l of (data ?? []) as any[]) {
    const end = l.new_value?.end_date
    if (typeof end === 'string' && !out.has(l.entity_id)) out.set(l.entity_id, end)
  }
  return out
}

export async function fetchPaymentsPage(db: Db, f: BillingFilters): Promise<{ rows: PaymentListRow[]; total: number }> {
  const subIds = f.qKind === 'uuid' || f.qKind === 'text' ? await findSubscriptionIdsByUserText(db, f) : []
  const from = (f.page - 1) * PAGE_SIZE
  let q = db.from('payments').select(LIST_SELECT, { count: 'exact' })
  q = applyPaymentFilters(q, f, subIds).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE_SIZE - 1)
  const { data, count, error } = await q
  fail(error, 'pagos')
  const rows = (data ?? []) as unknown as PaymentListRow[]
  const until = await fetchCoveredUntil(db, rows.map((r) => r.id))
  return { rows: rows.map((r) => ({ ...r, covered_until: until.get(r.id) ?? null })), total: count ?? 0 }
}

// ---------------- Eventos y alertas ----------------
export type EventRow = { id: string; topic: string | null; data_id: string | null; request_id: string | null; outcome: string | null; detail: string | null; received_at: string; processed_at: string | null; payment_id?: string | null }

export async function fetchEventsPage(db: Db, f: Pick<BillingFilters, 'page' | 'outcome'>): Promise<{ rows: EventRow[]; total: number }> {
  const from = (f.page - 1) * PAGE_SIZE
  let q = db.from('mp_webhook_events').select('id, topic, data_id, request_id, outcome, detail, received_at, processed_at', { count: 'exact' })
  if (f.outcome) q = q.eq('outcome', f.outcome)
  const { data, count, error } = await q.order('received_at', { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE_SIZE - 1)
  fail(error, 'eventos')
  const rows = (data ?? []) as EventRow[]
  // Enlace al pago local cuando el evento es de un pago (data_id = external_id).
  const ext = [...new Set(rows.filter((r) => r.topic === 'payment' && r.data_id).map((r) => r.data_id as string))]
  const map = new Map<string, string>()
  if (ext.length) {
    const { data: pays, error: e2 } = await db.from('payments').select('id, external_id').in('external_id', ext)
    fail(e2, 'pagos de eventos')
    for (const p of (pays ?? []) as any[]) map.set(p.external_id, p.id)
  }
  return { rows: rows.map((r) => ({ ...r, payment_id: r.topic === 'payment' && r.data_id ? map.get(r.data_id) ?? null : null })), total: count ?? 0 }
}

export type CancellingRow = { id: string; preapproval_id: string | null; last_error: string | null; cancel_attempts: number; updated_at: string; subscription_id: string; user_id: string | null; full_name: string | null }
export type IncidentRow = { id: string; action: string; entity: string; entity_id: string | null; created_at: string; new_value: any }
export type Alerts = {
  held: number; refundPending: number; unapplied: number; uncertainIntents: number; staleMpPending: number
  webhookProblems7d: number; incidents30d: number
  cancelling: CancellingRow[]; recentIncidents: IncidentRow[]; recentWebhookProblems: EventRow[]
}
const STALE_MP_PENDING_HOURS = 48

async function count(q: any, what: string): Promise<number> { const { count: c, error } = await q; fail(error, what); return c ?? 0 }

export async function fetchAlerts(db: Db, now = new Date()): Promise<Alerts> {
  const head = () => db.from('payments').select('id', { count: 'exact', head: true })
  const sinceIso = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString()
  const [held, refundPending, unapplied, uncertainIntents, staleMpPending, webhookProblems7d, incidents30d, cancellingRes, incidentsRes, problemsRes] = await Promise.all([
    count(applyCategoryFilter(head(), 'retenido'), 'retenidos'),
    count(applyCategoryFilter(head(), 'reembolso_pendiente'), 'reembolsos pendientes'),
    count(applyCategoryFilter(head(), 'sin_aplicar'), 'sin aplicar'),
    count(head().eq('provider', 'mercadopago').eq('status', 'pending').eq('mp_status', 'creation_uncertain'), 'intentos inciertos'),
    count(head().eq('provider', 'mercadopago').eq('status', 'pending').not('external_id', 'is', null).lt('created_at', sinceIso(STALE_MP_PENDING_HOURS)), 'pendientes antiguos'),
    count(db.from('mp_webhook_events').select('id', { count: 'exact', head: true }).in('outcome', ['error', 'rejected']).gte('received_at', sinceIso(24 * 7)), 'eventos con problema'),
    count(db.from('audit_logs').select('id', { count: 'exact', head: true }).like('action', 'mp_incident%').gte('created_at', sinceIso(24 * 30)), 'incidencias'),
    db.from('mp_preapprovals').select('id, preapproval_id, last_error, cancel_attempts, updated_at, subscription_id, subscriptions(user_id, profiles(full_name))').eq('status', 'cancelling').order('updated_at', { ascending: true }).limit(20),
    db.from('audit_logs').select('id, action, entity, entity_id, created_at, new_value').like('action', 'mp_incident%').order('created_at', { ascending: false }).limit(10),
    db.from('mp_webhook_events').select('id, topic, data_id, request_id, outcome, detail, received_at, processed_at').in('outcome', ['error', 'rejected']).order('received_at', { ascending: false }).limit(10),
  ])
  fail(cancellingRes.error, 'autorizaciones'); fail(incidentsRes.error, 'incidencias'); fail(problemsRes.error, 'eventos')
  return {
    held, refundPending, unapplied, uncertainIntents, staleMpPending, webhookProblems7d, incidents30d,
    cancelling: ((cancellingRes.data ?? []) as any[]).map((r) => ({ id: r.id, preapproval_id: r.preapproval_id, last_error: r.last_error, cancel_attempts: r.cancel_attempts, updated_at: r.updated_at, subscription_id: r.subscription_id, user_id: r.subscriptions?.user_id ?? null, full_name: r.subscriptions?.profiles?.full_name ?? null })),
    recentIncidents: (incidentsRes.data ?? []) as IncidentRow[],
    recentWebhookProblems: (problemsRes.data ?? []) as EventRow[],
  }
}

// ---------------- Detalle de pago ----------------
export async function fetchPaymentDetail(db: Db, id: string) {
  const { data: pay, error } = await db.from('payments')
    .select(`${PAYMENT_COLS}, checkout_url, plans(name, price, billing_period), subscriptions(id, user_id, status, start_date, end_date, mp_status, mp_preapproval_id, profiles(full_name, phone, created_at))`)
    .eq('id', id).maybeSingle()
  fail(error, 'pago')
  if (!pay) return null
  const [logs, recon, events] = await Promise.all([
    db.from('audit_logs').select('id, action, actor_id, new_value, created_at').eq('entity', 'payments').eq('entity_id', id).order('created_at', { ascending: false }).limit(50),
    db.from('bank_reconciliations').select('id, status, notes, reconciled_by, created_at').eq('payment_id', id).order('created_at', { ascending: false }).limit(10),
    (pay as any).external_id
      ? db.from('mp_webhook_events').select('id, topic, data_id, request_id, outcome, detail, received_at, processed_at').eq('data_id', (pay as any).external_id).order('received_at', { ascending: false }).limit(20)
      : Promise.resolve({ data: [], error: null }),
  ])
  fail(logs.error, 'auditoría'); fail(recon.error, 'conciliaciones'); fail(events.error, 'eventos')
  return { payment: pay as any, logs: (logs.data ?? []) as any[], reconciliations: (recon.data ?? []) as any[], events: (events.data ?? []) as EventRow[] }
}

// ---------------- Detalle de cliente ----------------
export async function fetchClientDetail(db: Db, userId: string, page: number) {
  const { data: profile, error } = await db.from('profiles').select('id, full_name, phone, role, created_at').eq('id', userId).maybeSingle()
  fail(error, 'perfil')
  if (!profile) return null
  const { data: subs, error: e2 } = await db.from('subscriptions')
    .select('id, status, start_date, end_date, created_at, cancelled_at, mp_status, mp_preapproval_id, mp_amount, trial_pending, plans!subscriptions_plan_id_fkey(name, price, billing_period)')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  fail(e2, 'suscripciones')
  const subRows = (subs ?? []) as any[]
  const subIds = subRows.map((s) => s.id)
  if (!subIds.length) return { profile: profile as any, subscriptions: [], preapprovals: [], payments: [], total: 0, incidents: [], webhookProblems: [] }
  const from = (page - 1) * PAGE_SIZE
  const [pre, pays] = await Promise.all([
    db.from('mp_preapprovals').select('id, subscription_id, preapproval_id, status, amount, last_error, cancel_attempts, created_at, updated_at, closed_at').in('subscription_id', subIds).order('created_at', { ascending: false }).limit(50),
    db.from('payments').select(`${PAYMENT_COLS}, plans(name, billing_period)`, { count: 'exact' }).in('subscription_id', subIds).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE_SIZE - 1),
  ])
  fail(pre.error, 'autorizaciones'); fail(pays.error, 'pagos')
  const preRows = (pre.data ?? []) as any[]
  const payRows = (pays.data ?? []) as any[]
  const until = await fetchCoveredUntil(db, payRows.map((p) => p.id))
  const entityIds = [...subIds, ...preRows.map((p) => p.id), ...payRows.map((p) => p.id)]
  const ext = payRows.map((p) => p.external_id).filter(Boolean) as string[]
  const [inc, wh] = await Promise.all([
    db.from('audit_logs').select('id, action, entity, entity_id, created_at, new_value').in('entity_id', entityIds).like('action', 'mp_incident%').order('created_at', { ascending: false }).limit(20),
    ext.length ? db.from('mp_webhook_events').select('id, topic, data_id, request_id, outcome, detail, received_at, processed_at').in('data_id', ext).in('outcome', ['error', 'rejected']).order('received_at', { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
  ])
  fail(inc.error, 'incidencias'); fail(wh.error, 'eventos')
  return {
    profile: profile as any, subscriptions: subRows, preapprovals: preRows,
    payments: payRows.map((p) => ({ ...p, covered_until: until.get(p.id) ?? null })), total: pays.count ?? 0,
    incidents: (inc.data ?? []) as IncidentRow[], webhookProblems: (wh.data ?? []) as EventRow[],
  }
}

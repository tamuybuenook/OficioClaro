// Acceso a datos del módulo de Mercado Pago. SOLO SERVIDOR (usa service_role).
import type { PlanPeriod } from '@/lib/plan-period'
import type { SupabaseClient } from '@supabase/supabase-js'
import { todayAR } from '@/lib/subscription-access'

export type PlanRow = { id: string; name: string; price: number; billing_period: PlanPeriod; is_active: boolean }
export type SubRow = {
  id: string; user_id: string; plan_id: string; status: string; end_date: string | null
  mp_preapproval_id: string | null; mp_plan_id: string | null; mp_amount: number | null; mp_status: string | null; mp_init_point: string | null
  /** Retención por eliminación en curso (vence a los 30 min; la base es la que decide, esto solo permite fallar rápido). */
  deletion_hold_at?: string | null
}
export const DELETION_HOLD_MINUTES = 30
export const deletionHoldActive = (s: Pick<SubRow, 'deletion_hold_at'>, now = Date.now()) =>
  !!s.deletion_hold_at && new Date(s.deletion_hold_at).getTime() > now - DELETION_HOLD_MINUTES * 60_000
/** La base rechazó abrir una autorización: cuenta suspendida o eliminación en curso (guardia del trigger, no una simple colisión). */
export class RenewalsBlockedError extends Error {}
// Ledger de autorizaciones recurrentes (tabla mp_preapprovals). `id` es el external_reference enviado a MP.
export type PreapprovalStatus = 'creating' | 'pending' | 'authorized' | 'paused' | 'cancelling' | 'cancelled' | 'failed'
export const OPEN_PREAPPROVAL: PreapprovalStatus[] = ['creating', 'pending', 'authorized', 'paused', 'cancelling']
export type PreapprovalRow = {
  id: string; subscription_id: string; plan_id: string; amount: number; preapproval_id: string | null
  status: PreapprovalStatus; init_point: string | null; cancel_attempts: number; last_error: string | null; created_at: string
}
export type PendingPaymentRow = {
  id: string; provider: string; status: string; mp_status: string | null; external_id: string | null
  applied_at: string | null; review_resolution: string | null; created_at: string
}
export type RecordPaymentArgs = {
  intentId: string | null; subscriptionId: string | null; preapprovalId?: string | null; externalId: string
  mpStatus: string; mpStatusDetail: string | null; amount: number; currency: string
}

export type MpStore = {
  logEvent(e: { topic: string | null; dataId: string | null; requestId: string | null }): Promise<string | null>
  finishEvent(id: string | null, outcome: string, detail?: string): Promise<void>
  getIntent(id: string): Promise<{ id: string; subscription_id: string } | null>
  getPreapprovalByMpId(preapprovalId: string): Promise<PreapprovalRow | null>
  getPreapprovalById(id: string): Promise<PreapprovalRow | null>
  listOpenPreapprovals(subscriptionId: string): Promise<PreapprovalRow[]>
  listPreapprovalsToRecover(f: { olderThanMinutes: number; limit: number }): Promise<PreapprovalRow[]>
  /** null = ya hay una autorización abierta para esa suscripción (índice único): solicitud simultánea o reemplazo a medias. */
  createPreapprovalRow(a: { subscriptionId: string; planId: string; amount: number }): Promise<{ id: string } | null>
  attachPreapproval(id: string, preapprovalId: string, initPoint: string | null, status?: PreapprovalStatus): Promise<void>
  setPreapprovalStatus(id: string, status: PreapprovalStatus): Promise<void>
  markCancelling(id: string): Promise<void>
  markCancelled(id: string): Promise<void>
  recordCancelFailure(id: string, message: string): Promise<void>
  markPreapprovalFailed(id: string, message: string): Promise<void>
  logIncident(entity: string, entityId: string, action: string, detail: Record<string, unknown>, actorId?: string | null): Promise<void>
  /** Suspende/cancela la suscripción y deja TODAS las autorizaciones abiertas en 'cancelling', en una sola transacción (RPC mp_begin_wind_down). */
  beginWindDown(a: { subscriptionId: string; status: 'suspended' | 'cancelled'; planId: string | null; actorId: string | null }): Promise<{ previousStatus: string; preapprovalIds: string[] }>
  getSubscriptionsOfUser(userId: string): Promise<{ id: string; status: string }[]>
  /** Cobros de MP aprobados y retenidos para revisión, todavía sin resolver o con reembolso pendiente (refund_pending). */
  countHeldPayments(userId: string): Promise<number>
  recordPayment(args: RecordPaymentArgs): Promise<{ outcome: string; detail?: string }>
  getPlan(planId: string): Promise<PlanRow | null>
  getLatestSubscription(userId: string): Promise<SubRow | null>
  createLapsedSubscription(userId: string, planId: string): Promise<SubRow>
  /** Activa la retención de eliminación y deja las autorizaciones abiertas en 'cancelling' (RPC mp_begin_user_deletion). */
  beginUserDeletion(a: { userId: string; actorId: string | null }): Promise<{ subscriptionIds: string[]; preapprovalIds: string[]; pendingPaymentIds: string[] }>
  endUserDeletionHold(userId: string): Promise<void>
  /** Retención de eliminación POR USUARIO vigente (tabla mp_deletion_holds): sirve aunque la cuenta no tenga suscripción. Solo para fallar rápido; la base decide. */
  isUserDeletionHeld(userId: string): Promise<boolean>
  /** Pagos que requieren conciliación: pendientes (MP o transferencia) o cobros retenidos sin resolver. */
  listPendingPaymentsOfUser(userId: string): Promise<PendingPaymentRow[]>
  /** Mantiene la intención PENDIENTE marcando que el resultado de crear la preferencia es incierto (timeout/red/5xx). Nunca la da por fallida. */
  markIntentUncertain(id: string): Promise<void>
  /** Cuenta y registro de un cobro/autorización de una cuenta YA ELIMINADA (instantánea de audit_logs). null = sin rastro. Best-effort. */
  traceDeletedPayment(ref: string): Promise<Record<string, unknown> | null>
  /** Cierra una intención sin pago, solo si venció (RPC mp_expire_intent). */
  expireIntent(id: string): Promise<{ expired: boolean; reason?: string }>
  findReusableIntent(subscriptionId: string, planId: string, amount: number, sinceIso: string): Promise<{ id: string; checkout_url: string } | null>
  createIntent(args: { subscriptionId: string; planId: string; amount: number }): Promise<{ id: string }>
  setIntentCheckout(id: string, url: string): Promise<void>
  failIntent(id: string): Promise<void>
  listOpenIntents(f: { userId?: string; olderThanMinutes: number; newerThanHours: number; limit: number }): Promise<{ id: string }[]>
}

const PRE_COLS = 'id, subscription_id, plan_id, amount, preapproval_id, status, init_point, cancel_attempts, last_error, created_at'
const normalizePre = (r: any): PreapprovalRow | null => (r ? ({ ...r, amount: Number(r.amount) } as PreapprovalRow) : null)
const SUB_COLS = 'id, user_id, plan_id, status, end_date, mp_preapproval_id, mp_plan_id, mp_amount, mp_status, mp_init_point, deletion_hold_at'

export function createSupabaseMpStore(db: SupabaseClient): MpStore {
  const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message) }
  const mapBlocked = (e: { message: string } | null) => { if (e?.message?.includes('mp:renewals_blocked')) throw new RenewalsBlockedError(e.message) }
  return {
    async logEvent(e) {
      const { data, error } = await db.from('mp_webhook_events')
        .insert({ topic: e.topic, data_id: e.dataId, request_id: e.requestId }).select('id').single()
      return error ? null : (data?.id ?? null) // el registro es auditoría: no debe frenar el procesamiento
    },
    async finishEvent(id, outcome, detail) {
      if (!id) return
      await db.from('mp_webhook_events').update({ outcome, detail: detail?.slice(0, 500) ?? null, processed_at: new Date().toISOString() }).eq('id', id)
    },
    async getIntent(id) {
      const { data, error } = await db.from('payments').select('id, subscription_id').eq('id', id).eq('provider', 'mercadopago').maybeSingle()
      fail(error); return data
    },
    async getPreapprovalByMpId(preapprovalId) {
      const { data, error } = await db.from('mp_preapprovals').select(PRE_COLS).eq('preapproval_id', preapprovalId).maybeSingle()
      fail(error); return normalizePre(data)
    },
    async getPreapprovalById(id) {
      const { data, error } = await db.from('mp_preapprovals').select(PRE_COLS).eq('id', id).maybeSingle()
      fail(error); return normalizePre(data)
    },
    async listOpenPreapprovals(subscriptionId) {
      const { data, error } = await db.from('mp_preapprovals').select(PRE_COLS).eq('subscription_id', subscriptionId).in('status', OPEN_PREAPPROVAL)
        .order('created_at', { ascending: false })
      fail(error); return (data ?? []).map((r) => normalizePre(r)!)
    },
    async listPreapprovalsToRecover(f) {
      const { data, error } = await db.from('mp_preapprovals').select(PRE_COLS)
        .or('status.eq.cancelling,status.eq.creating')
        .lte('updated_at', new Date(Date.now() - f.olderThanMinutes * 60_000).toISOString()).limit(f.limit)
      fail(error); return (data ?? []).map((r) => normalizePre(r)!)
    },
    async createPreapprovalRow(a) {
      const { data, error } = await db.from('mp_preapprovals').insert({ subscription_id: a.subscriptionId, plan_id: a.planId, amount: a.amount }).select('id').single()
      if (error) {
        if ((error as any).code === '23505') return null
        if (error.message?.includes('mp:renewals_blocked')) throw new RenewalsBlockedError(error.message)
        throw new Error(error.message)
      }
      return data as { id: string }
    },
    async attachPreapproval(id, preapprovalId, initPoint, status = 'pending') {
      const { error } = await db.from('mp_preapprovals').update({ preapproval_id: preapprovalId, init_point: initPoint, status, updated_at: new Date().toISOString() })
        .eq('id', id).in('status', ['creating', 'pending'])
      fail(error)
      // Una creación que quedó en seguimiento ('cancelling') mientras MP respondía: se vincula el id SIN reabrirla,
      // para que la cancelación pueda completarse.
      const { error: e2 } = await db.from('mp_preapprovals').update({ preapproval_id: preapprovalId, init_point: initPoint, updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'cancelling').is('preapproval_id', null)
      fail(e2)
    },
    async setPreapprovalStatus(id, status) {
      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
      if (status === 'cancelled' || status === 'failed') patch.closed_at = new Date().toISOString()
      const { error } = await db.from('mp_preapprovals').update(patch).eq('id', id); fail(error)
    },
    async markCancelling(id) {
      const { data } = await db.from('mp_preapprovals').select('cancel_attempts').eq('id', id).maybeSingle()
      const { error } = await db.from('mp_preapprovals').update({ status: 'cancelling', cancel_attempts: ((data as any)?.cancel_attempts ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', id).in('status', ['pending', 'authorized', 'paused', 'cancelling', 'creating'])
      fail(error)
    },
    async markCancelled(id) {
      const { error } = await db.from('mp_preapprovals').update({ status: 'cancelled', last_error: null, closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
      fail(error)
    },
    async recordCancelFailure(id, message) {
      const { error } = await db.from('mp_preapprovals').update({ last_error: message.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', id); fail(error)
    },
    async markPreapprovalFailed(id, message) {
      const { error } = await db.from('mp_preapprovals').update({ status: 'failed', last_error: message.slice(0, 300), closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id).in('status', ['creating', 'cancelling']) // 'cancelling' sin id: una creación que quedó en seguimiento y MP nunca llegó a crear
      fail(error)
    },
    async logIncident(entity, entityId, action, detail, actorId = null) {
      await db.from('audit_logs').insert({ actor_id: actorId, entity, entity_id: entityId, action, new_value: detail }) // auditoría: no debe frenar el flujo
    },
    async beginWindDown(a) {
      const { data, error } = await db.rpc('mp_begin_wind_down', { p_subscription_id: a.subscriptionId, p_status: a.status, p_plan_id: a.planId, p_actor: a.actorId })
      fail(error)
      const r = data as { previous_status: string; preapproval_ids: string[] }
      return { previousStatus: r.previous_status, preapprovalIds: r.preapproval_ids ?? [] }
    },
    async beginUserDeletion(a) {
      const { data, error } = await db.rpc('mp_begin_user_deletion', { p_user_id: a.userId, p_actor: a.actorId })
      fail(error)
      const r = data as { subscription_ids: string[]; preapproval_ids: string[]; pending_payment_ids?: string[] }
      return { subscriptionIds: r.subscription_ids ?? [], preapprovalIds: r.preapproval_ids ?? [], pendingPaymentIds: r.pending_payment_ids ?? [] }
    },
    async endUserDeletionHold(userId) {
      const { error } = await db.rpc('mp_end_user_deletion_hold', { p_user_id: userId }); fail(error)
    },
    async isUserDeletionHeld(userId) {
      const { data, error } = await db.from('mp_deletion_holds').select('held_at').eq('user_id', userId).maybeSingle()
      fail(error)
      return !!data && new Date((data as any).held_at).getTime() > Date.now() - DELETION_HOLD_MINUTES * 60_000
    },
    async listPendingPaymentsOfUser(userId) {
      const { data: subs, error: e1 } = await db.from('subscriptions').select('id').eq('user_id', userId)
      fail(e1)
      const ids = (subs ?? []).map((x: any) => x.id)
      if (ids.length === 0) return []
      const { data, error } = await db.from('payments')
        .select('id, provider, status, mp_status, external_id, applied_at, review_resolution, created_at')
        .in('subscription_id', ids).or('status.eq.pending,and(status.eq.reconciled,applied_at.is.null,or(review_resolution.is.null,review_resolution.eq.refund_pending))')
      fail(error); return (data ?? []) as PendingPaymentRow[]
    },
    async traceDeletedPayment(ref) {
      const { data, error } = await db.rpc('mp_trace_deleted_payment', { p_ref: ref })
      fail(error)
      const r = data as Record<string, unknown> | null
      return r && r.found ? r : null
    },
    async markIntentUncertain(id) {
      await db.from('payments').update({ mp_status: 'creation_uncertain' }).eq('id', id).eq('status', 'pending').is('external_id', null)
    },
    async expireIntent(id) {
      const { data, error } = await db.rpc('mp_expire_intent', { p_intent_id: id })
      fail(error); return data as { expired: boolean; reason?: string }
    },
    async getSubscriptionsOfUser(userId) {
      const { data, error } = await db.from('subscriptions').select('id, status').eq('user_id', userId)
      fail(error); return (data ?? []) as { id: string; status: string }[]
    },
    async countHeldPayments(userId) {
      const { data: subs, error: e1 } = await db.from('subscriptions').select('id').eq('user_id', userId)
      fail(e1)
      const ids = (subs ?? []).map((x: any) => x.id)
      if (ids.length === 0) return 0
      const { count, error } = await db.from('payments').select('id', { count: 'exact', head: true })
        .in('subscription_id', ids).eq('provider', 'mercadopago').eq('status', 'reconciled').not('review_reason', 'is', null).or('review_resolution.is.null,review_resolution.eq.refund_pending')
      fail(error); return count ?? 0
    },
    async recordPayment(a) {
      const { data, error } = await db.rpc('record_mp_payment', {
        p_intent_id: a.intentId, p_subscription_id: a.subscriptionId, p_preapproval_id: a.preapprovalId ?? null, p_external_id: a.externalId,
        p_mp_status: a.mpStatus, p_mp_status_detail: a.mpStatusDetail, p_amount: a.amount, p_currency: a.currency,
      })
      fail(error); return data as { outcome: string; detail?: string }
    },
    async getPlan(planId) {
      const { data, error } = await db.from('plans').select('id, name, price, billing_period, is_active').eq('id', planId).maybeSingle()
      fail(error); return data ? ({ ...data, price: Number(data.price) } as PlanRow) : null
    },
    async getLatestSubscription(userId) {
      const { data, error } = await db.from('subscriptions').select(SUB_COLS).eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      fail(error); return data as SubRow | null
    },
    async createLapsedSubscription(userId, planId) {
      const y = todayAR(new Date(Date.now() - 2 * 86_400_000)) // fecha AR, no UTC: nunca debe dar acceso
      const { data, error } = await db.from('subscriptions').insert({ user_id: userId, plan_id: planId, status: 'past_due', end_date: y }).select(SUB_COLS).single()
      mapBlocked(error); fail(error); return data as SubRow
    },
    async findReusableIntent(subscriptionId, planId, amount, sinceIso) {
      const { data, error } = await db.from('payments').select('id, checkout_url')
        .eq('subscription_id', subscriptionId).eq('provider', 'mercadopago').eq('status', 'pending').eq('plan_id', planId).eq('amount', amount)
        .is('external_id', null).not('checkout_url', 'is', null).gte('created_at', sinceIso)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      fail(error); return data as { id: string; checkout_url: string } | null
    },
    async createIntent(a) {
      const { data, error } = await db.from('payments').insert({
        subscription_id: a.subscriptionId, provider: 'mercadopago', amount: a.amount, plan_id: a.planId, status: 'pending', mp_status: 'created',
      }).select('id').single()
      mapBlocked(error); fail(error); return data as { id: string }
    },
    async setIntentCheckout(id, url) {
      const { error } = await db.from('payments').update({ checkout_url: url }).eq('id', id); fail(error)
    },
    async failIntent(id) {
      await db.from('payments').update({ status: 'rejected', mp_status: 'creation_failed' }).eq('id', id).is('external_id', null)
    },
    async listOpenIntents(f) {
      let q = db.from('payments').select('id, subscription_id').eq('provider', 'mercadopago').eq('status', 'pending').is('applied_at', null)
        .lte('created_at', new Date(Date.now() - f.olderThanMinutes * 60_000).toISOString())
        .gte('created_at', new Date(Date.now() - f.newerThanHours * 3_600_000).toISOString())
        .order('created_at', { ascending: false }).limit(f.limit)
      if (f.userId) {
        const { data: subs, error: e1 } = await db.from('subscriptions').select('id').eq('user_id', f.userId)
        fail(e1)
        const ids = (subs ?? []).map((x: any) => x.id)
        if (ids.length === 0) return []
        q = q.in('subscription_id', ids)
      }
      const { data, error } = await q
      fail(error); return (data ?? []).map((x: any) => ({ id: x.id }))
    },
  }
}

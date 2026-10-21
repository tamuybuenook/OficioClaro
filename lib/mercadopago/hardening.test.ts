import { describe, expect, it, vi, beforeEach } from 'vitest'
import { allow } from '../rate-limit'
import { reconcileIntents } from './reconcile'
import { startCheckout, CheckoutError } from './checkout'
import type { MpClient } from './client'
import type { MpStore } from './store'

const PLAN = { id: '11111111-1111-1111-1111-111111111111', name: 'Pro', price: 9000, billing_period: 'monthly' as const, is_active: true }
const SUB = (over: any = {}) => ({ id: '33333333-3333-3333-3333-333333333333', user_id: 'u1', plan_id: PLAN.id, status: 'active', end_date: '2099-01-01',
  mp_preapproval_id: null, mp_plan_id: null, mp_amount: null, mp_status: null, mp_init_point: null, ...over })
const store = (sub: any, extra: Partial<MpStore> = {}) => ({
  getPlan: async () => PLAN, getLatestSubscription: async () => sub, createLapsedSubscription: async () => sub,
  listOpenPreapprovals: async () => [], isUserDeletionHeld: async () => false, markIntentUncertain: async (id: string) => { /* sin cambios */ }, createPreapprovalRow: async () => ({ id: 'row1' }), attachPreapproval: async () => {}, findReusableIntent: async () => null, createIntent: async () => ({ id: 'i1' }), setIntentCheckout: async () => {}, failIntent: async () => {},
  ...extra,
}) as unknown as MpStore

describe('rate limit (Postgres, compartido entre instancias)', () => {
  it('permite mientras todas las ventanas respondan true y corta en la primera que falla', async () => {
    const calls: any[] = []
    const db = { rpc: async (_f: string, a: any) => { calls.push(a); return { data: a.p_window_seconds === 600, error: null } } }
    expect(await allow('u1', 'checkout', db)).toBe(false) // la ventana diaria (86400) responde false
    expect(calls.map((c) => c.p_key)).toEqual(['checkout:0:u1', 'checkout:1:u1'])
    expect(await allow('u1', 'sync', db)).toBe(true)
  })
  it('falla cerrado si la base no responde', async () => {
    const db = { rpc: async () => ({ data: null, error: { message: 'down' } }) }
    expect(await allow('u1', 'cancel', db)).toBe(false)
  })
})

describe('checkout: estados no autorizados y doble cobro', () => {
  const mp = { request: vi.fn() } as unknown as MpClient
  const d = (s: MpStore) => ({ store: s, mp, appUrl: 'https://app.test' })
  const base = { userId: 'u1', email: 'a@b.com', planId: PLAN.id }
  it('con renovación automática activa no se genera un pago manual (evita cobrar dos veces)', async () => {
    await expect(startCheckout(d(store(SUB({ mp_status: 'authorized' }))), { ...base, mode: 'one_time' })).rejects.toThrow(/renovación automática/)
  })
  it('suspendidos no pueden iniciar ningún checkout', async () => {
    for (const mode of ['one_time', 'recurring'] as const)
      await expect(startCheckout(d(store(SUB({ status: 'suspended' }))), { ...base, mode })).rejects.toBeInstanceOf(CheckoutError)
  })
  it('payer_email: valida formato; usa el informado o el de la cuenta', async () => {
    const m = { request: vi.fn().mockResolvedValue({ id: 'P', init_point: 'u' }) } as unknown as MpClient
    await expect(startCheckout({ store: store(SUB()), mp: m, appUrl: 'https://app.test' }, { ...base, mode: 'recurring', payerEmail: 'no-es-email' })).rejects.toThrow(/email válido/)
    await startCheckout({ store: store(SUB()), mp: m, appUrl: 'https://app.test' }, { ...base, mode: 'recurring', payerEmail: ' mp@x.com ' })
    expect((m.request as any).mock.calls[0][2].payer_email).toBe('mp@x.com')
    await startCheckout({ store: store(SUB()), mp: m, appUrl: 'https://app.test' }, { ...base, mode: 'recurring', payerEmail: '' })
    expect((m.request as any).mock.calls[1][2].payer_email).toBe('a@b.com')
  })
})

describe('conciliación activa', () => {
  it('busca por external_reference y procesa cada pago por el camino del webhook', async () => {
    const recorded: any[] = []
    const st = { listOpenIntents: async () => [{ id: '22222222-2222-2222-2222-222222222222' }],
      getIntent: async (id: string) => ({ id, subscription_id: 's' }), recordPayment: async (a: any) => { recorded.push(a); return { outcome: 'processed' } } } as unknown as MpStore
    const mp = { request: async (_m: string, path: string) => path.startsWith('/v1/payments/search')
      ? { results: [{ id: 5 }] }
      : { id: 5, status: 'approved', external_reference: '22222222-2222-2222-2222-222222222222', transaction_amount: 9000, currency_id: 'ARS' } } as unknown as MpClient
    const r = await reconcileIntents({ mp, store: st }, { olderThanMinutes: 0, newerThanHours: 72, limit: 5 })
    expect(r).toEqual({ checked: 1, processed: 1, errors: 0 })
    expect(recorded[0]).toMatchObject({ externalId: '5', mpStatus: 'approved', amount: 9000 })
  })
  it('un error en una operación no frena las demás', async () => {
    const st = { listOpenIntents: async () => [{ id: 'a' }, { id: 'b' }] } as unknown as MpStore
    const mp = { request: async () => { throw new Error('x') } } as unknown as MpClient
    expect(await reconcileIntents({ mp, store: st }, { olderThanMinutes: 0, newerThanHours: 1, limit: 5 })).toEqual({ checked: 2, processed: 0, errors: 2 })
  })
})

import { describe, expect, it } from 'vitest'
import type { MpClient } from './client'
import type { MpStore, PlanRow, SubRow } from './store'
import { CheckoutError, startCheckout } from './checkout'

const SUBID = '33333333-3333-3333-3333-333333333333'
const SUB: SubRow = { id: SUBID, user_id: 'u1', plan_id: 'x', status: 'active', end_date: '2099-01-01', mp_preapproval_id: null, mp_plan_id: null, mp_amount: null, mp_status: null, mp_init_point: null }
const plan = (billing_period: string, price: number): PlanRow => ({ id: '11111111-1111-1111-1111-111111111111', name: 'Plan', price, billing_period: billing_period as any, is_active: true })

function setup(p: PlanRow) {
  const created: any[] = []; const calls: any[] = []
  const store = {
    getPlan: async () => p, getLatestSubscription: async () => SUB, createLapsedSubscription: async () => SUB,
    listOpenPreapprovals: async () => [], isUserDeletionHeld: async () => false, getPreapprovalById: async () => null, markPreapprovalFailed: async () => undefined,
    createPreapprovalRow: async (a: any) => { created.push(a); return { id: '00000000-0000-0000-0000-000000000001' } },
    attachPreapproval: async () => undefined,
  } as unknown as MpStore
  const mp: MpClient = { request: async (method: string, path: string, body?: any) => { calls.push({ method, path, body }); return { id: 'PRE1', init_point: 'https://mp/auth' } } } as MpClient
  return { d: { store, mp, appUrl: 'https://app.test' }, created, calls }
}
const input = { userId: 'u1', email: 'a@b.com', planId: '11111111-1111-1111-1111-111111111111', mode: 'recurring' as const }

describe('renovación automática: frecuencia enviada a Mercado Pago según el período del plan', () => {
  for (const [period, months, price] of [['monthly', 1, 9000], ['quarterly', 3, 24000], ['semiannual', 6, 45000], ['yearly', 12, 90000]] as const) {
    it(`${period}: cada ${months} mes(es), por el precio del plan`, async () => {
      const s = setup(plan(period, price))
      await startCheckout(s.d, input)
      expect(s.calls).toHaveLength(1)
      expect(s.calls[0].body.auto_recurring).toEqual({ frequency: months, frequency_type: 'months', transaction_amount: price, currency_id: 'ARS' })
    })
  }
  it('un período desconocido NO se cobra por defecto: error claro y no se registra ni se llama a Mercado Pago', async () => {
    const s = setup(plan('weekly', 1000))
    await expect(startCheckout(s.d, input)).rejects.toBeInstanceOf(CheckoutError)
    await expect(startCheckout(s.d, input)).rejects.toThrow(/período de cobro válido/)
    expect(s.created).toHaveLength(0); expect(s.calls).toHaveLength(0)
  })
})

import { describe, it, expect } from 'vitest'
import { desiredNotifications, pickBanner, inSync, KIND_PRIORITY, NOTIFICATION_KINDS, type RulesInput } from './rules'

const base: RulesInput = { subscriptionId: 's1', phase: 'active_manual', daysToEnd: 20, graceEndsOn: null, endDate: '2026-11-30', subStatus: 'active', noticeDays: 5, lastPayment: null, today: '2026-11-10' }
const kinds = (o: Partial<RulesInput>) => desiredNotifications({ ...base, ...o }).map((d) => d.kind)

describe('desiredNotifications: un aviso por fase', () => {
  it('sin avisos en fases tranquilas', () => {
    for (const phase of ['none', 'trial', 'cancelled_end', 'suspended_admin'] as const) expect(kinds({ phase })).toEqual([])
  })
  it('prueba por terminar', () => { expect(kinds({ phase: 'trial_ending', daysToEnd: 3, subStatus: 'trial' })).toEqual(['trial_ending']) })
  it('cobro automático próximo: solo dentro de la ventana de aviso', () => {
    expect(kinds({ phase: 'active_auto', daysToEnd: 5 })).toEqual(['auto_charge_upcoming'])
    expect(kinds({ phase: 'active_auto', daysToEnd: 6 })).toEqual([])
  })
  it('renovación sin autorizar y vencimiento manual: solo dentro de la ventana', () => {
    expect(kinds({ phase: 'renewal_off', daysToEnd: 2 })).toEqual(['renewal_not_authorized']); expect(kinds({ phase: 'renewal_off', daysToEnd: 9 })).toEqual([])
    expect(kinds({ phase: 'active_manual', daysToEnd: 0 })).toEqual(['manual_due_soon']); expect(kinds({ phase: 'active_manual', daysToEnd: 9 })).toEqual([])
  })
  it('la ventana respeta el aviso configurado', () => {
    expect(kinds({ phase: 'active_manual', daysToEnd: 9, noticeDays: 10 })).toEqual(['manual_due_soon'])
  })
  it('cobro fallido y gracia', () => {
    expect(kinds({ phase: 'payment_failed', daysToEnd: 2, subStatus: 'past_due' })).toEqual(['payment_failed'])
    const g = desiredNotifications({ ...base, phase: 'grace', daysToEnd: -2, endDate: '2026-11-08', graceEndsOn: '2026-11-13' })[0]
    expect(g).toMatchObject({ kind: 'grace_period', severity: 'warning', due_date: '2026-11-13', dedupe_key: 'grace_period:s1:2026-11-08' })
  })
  it('suspensión por falta de pago, con motivo', () => {
    expect(desiredNotifications({ ...base, phase: 'lapsed', daysToEnd: -9, subStatus: 'active' })[0]).toMatchObject({ kind: 'suspended_nonpayment', severity: 'danger', payload: { reason: 'unpaid' } })
    expect(desiredNotifications({ ...base, phase: 'lapsed', daysToEnd: -1, subStatus: 'trial' })[0].payload.reason).toBe('trial_ended')
  })
})

describe('claves de deduplicación', () => {
  it('misma situación = misma clave (repetir no duplica); otro período = otra clave', () => {
    const a = desiredNotifications({ ...base, phase: 'payment_failed', daysToEnd: 2 })[0].dedupe_key
    expect(desiredNotifications({ ...base, phase: 'payment_failed', daysToEnd: 1 })[0].dedupe_key).toBe(a)
    expect(desiredNotifications({ ...base, phase: 'payment_failed', daysToEnd: 2, endDate: '2026-12-30' })[0].dedupe_key).not.toBe(a)
  })
  it('sin fecha de vencimiento no se rompe', () => { expect(desiredNotifications({ ...base, phase: 'payment_failed', endDate: null })[0].dedupe_key).toBe('payment_failed:s1:sin-fecha') })
})

describe('pago confirmado', () => {
  it('se muestra durante 7 días y usa el id del pago como clave', () => {
    const d = (date: string) => desiredNotifications({ ...base, lastPayment: { id: 'p1', date } }).filter((x) => x.kind === 'payment_confirmed')
    expect(d('2026-11-10')[0]).toMatchObject({ dedupe_key: 'payment_confirmed:s1:p1', source: 'payment', severity: 'info' })
    expect(d('2026-11-03')).toHaveLength(1); expect(d('2026-11-02')).toHaveLength(0)
    expect(d('2026-11-11')).toHaveLength(0) // fecha futura: no corresponde
  })
  it('convive con el aviso de fase', () => {
    expect(kinds({ phase: 'active_manual', daysToEnd: 3, lastPayment: { id: 'p1', date: '2026-11-09' } })).toEqual(['manual_due_soon', 'payment_confirmed'])
  })
})

describe('pickBanner e inSync', () => {
  it('elige por prioridad: suspensión > gracia > pago fallido > avisos > informativos', () => {
    const mk = (kind: any, due: string | null = null) => ({ kind, due_date: due })
    expect(pickBanner([mk('payment_confirmed'), mk('manual_due_soon'), mk('grace_period')])?.kind).toBe('grace_period')
    expect(pickBanner([mk('payment_failed'), mk('suspended_nonpayment')])?.kind).toBe('suspended_nonpayment')
    expect(pickBanner([])).toBeNull()
  })
  it('todas las clases tienen prioridad definida', () => { for (const k of NOTIFICATION_KINDS) expect(KIND_PRIORITY[k]).toBeGreaterThan(0) })
  it('inSync compara conjuntos de claves', () => {
    const d = desiredNotifications({ ...base, phase: 'payment_failed', daysToEnd: 1 })
    expect(inSync([d[0].dedupe_key], d)).toBe(true); expect(inSync([], d)).toBe(false); expect(inSync([d[0].dedupe_key, 'x'], d)).toBe(false); expect(inSync([], [])).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { notificationText } from './messages'
import { NOTIFICATION_KINDS } from './rules'

describe('notificationText', () => {
  it('todos los tipos tienen texto no vacío, sin «undefined» ni «NaN» aunque falten datos', () => {
    for (const k of NOTIFICATION_KINDS) for (const p of [null, {}, { end_date: '2026-11-30', days: 3, grace_ends_on: '2026-12-05' }]) {
      const t = notificationText(k, p, null); expect(t.length).toBeGreaterThan(20); expect(t).not.toMatch(/undefined|NaN|null/)
    }
  })
  it('usa fechas dd/mm/yyyy y singular/plural', () => {
    expect(notificationText('manual_due_soon', { end_date: '2026-11-30', days: 1 }, null)).toMatch(/30\/11\/2026 \(en 1 día\)/)
    expect(notificationText('manual_due_soon', { end_date: '2026-11-30', days: 4 }, null)).toMatch(/en 4 días/)
    expect(notificationText('manual_due_soon', { days: 0 }, null)).toMatch(/vence hoy/)
    expect(notificationText('trial_ending', { end_date: '2026-11-30', days: 0 }, null)).toMatch(/termina hoy/)
  })
  it('gracia: muestra vencimiento y corte', () => {
    const t = notificationText('grace_period', { end_date: '2026-11-08', grace_ends_on: '2026-11-13' }, '2026-11-13')
    expect(t).toMatch(/venció el 08\/11\/2026/); expect(t).toMatch(/hasta el 13\/11\/2026/)
  })
  it('suspensión: distingue prueba terminada de falta de pago', () => {
    expect(notificationText('suspended_nonpayment', { reason: 'trial_ended' }, null)).toMatch(/prueba gratuita terminó/)
    expect(notificationText('suspended_nonpayment', { reason: 'unpaid' }, null)).toMatch(/suscripción venció/)
  })
  it('pago confirmado: informa hasta cuándo está al día', () => {
    expect(notificationText('payment_confirmed', { end_date: '2026-12-30' }, null)).toMatch(/al día hasta el 30\/12\/2026/)
  })
  it('si falta end_date usa la fecha de vencimiento del aviso', () => {
    expect(notificationText('payment_failed', {}, '2026-11-12')).toMatch(/antes del 12\/11\/2026/)
  })
})

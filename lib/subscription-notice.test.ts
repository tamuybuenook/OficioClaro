import { describe, it, expect } from 'vitest'
import { accessNotice, fmtDay, type AccessView } from './subscription-notice'

const base: AccessView = { phase: 'active_manual', locked: false, daysToEnd: 20, graceEndsOn: null, endDate: '2026-11-10', subStatus: 'active' }

describe('fmtDay', () => {
  it('formatea sin zona horaria', () => { expect(fmtDay('2026-11-05')).toBe('05/11/2026') })
  it('valores inválidos o vacíos', () => { expect(fmtDay(null)).toBe('—'); expect(fmtDay('x')).toBe('—') })
})

describe('accessNotice', () => {
  it('sin aviso en fases normales', () => {
    for (const phase of ['trial', 'active_auto', 'active_manual', 'renewal_off', 'cancelled_end'] as const) expect(accessNotice({ ...base, phase })).toBeNull()
  })
  it('prueba por terminar: singular, plural y último día', () => {
    expect(accessNotice({ ...base, phase: 'trial_ending', daysToEnd: 1 })?.text).toMatch(/en 1 día \(10\/11\/2026\)/)
    expect(accessNotice({ ...base, phase: 'trial_ending', daysToEnd: 4 })?.text).toMatch(/en 4 días/)
    expect(accessNotice({ ...base, phase: 'trial_ending', daysToEnd: 0 })?.text).toMatch(/termina hoy/)
  })
  it('cobro fallido: avisa la fecha límite', () => {
    const n = accessNotice({ ...base, phase: 'payment_failed', subStatus: 'past_due' })
    expect(n?.tone).toBe('warning'); expect(n?.text).toMatch(/antes del 10\/11\/2026/)
  })
  it('gracia: indica hasta cuándo conserva el acceso', () => {
    const n = accessNotice({ ...base, phase: 'grace', daysToEnd: -2, endDate: '2026-11-01', graceEndsOn: '2026-11-06' })
    expect(n?.text).toMatch(/venció el 01\/11\/2026/); expect(n?.text).toMatch(/hasta el 06\/11\/2026/)
  })
  it('bloqueado tras terminar la prueba sin pago: mensaje de prueba', () => {
    const n = accessNotice({ ...base, phase: 'lapsed', locked: true, subStatus: 'trial', daysToEnd: -1 })
    expect(n?.tone).toBe('danger'); expect(n?.text).toMatch(/prueba gratuita terminó/)
  })
  it('bloqueado por falta de pago: mensaje de vencimiento', () => {
    expect(accessNotice({ ...base, phase: 'lapsed', locked: true, subStatus: 'active', daysToEnd: -9 })?.text).toMatch(/suscripción venció/)
  })
  it('bloqueado sin suscripción: mensaje de vencimiento', () => {
    expect(accessNotice({ ...base, phase: 'none', locked: true, subStatus: null })?.text).toMatch(/solo podés ver esta pantalla/)
  })
  it('suspendida por el admin', () => {
    expect(accessNotice({ ...base, phase: 'suspended_admin', locked: true, subStatus: 'suspended' })?.text).toMatch(/suspendida/)
  })
})

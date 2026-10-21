import { describe, it, expect } from 'vitest'
import { getSubscriptionPhase as ph, normalizeSettings, addDays, daysBetween } from './subscription-phase'
import { hasAccess } from './subscription-access'

const T = '2026-10-19'
const st = { noticeDays: 5, graceDays: 5 }

describe('fechas', () => {
  it('suma y resta días sin errores de zona horaria ni fin de mes', () => {
    expect(addDays('2026-10-30', 5)).toBe('2026-11-04'); expect(addDays('2026-02-26', 5)).toBe('2026-03-03')
    expect(daysBetween('2026-10-19', '2026-10-24')).toBe(5); expect(daysBetween('2026-10-19', '2026-10-18')).toBe(-1)
  })
})
describe('configuración', () => {
  it('usa valores iniciales si falta o es inválida', () => {
    expect(normalizeSettings(null)).toEqual(st); expect(normalizeSettings({ noticeDays: 'x', graceDays: -1 })).toEqual(st)
    expect(normalizeSettings({ noticeDays: 99, graceDays: 99 })).toEqual(st); expect(normalizeSettings({ noticeDays: 7, graceDays: 0 })).toEqual({ noticeDays: 7, graceDays: 0 })
  })
})
describe('fases', () => {
  it('sin suscripción / suspendida por admin: sin acceso, aunque quede período', () => {
    expect(ph(null, st, T)).toMatchObject({ phase: 'none', hasAccess: false })
    expect(ph({ status: 'suspended', end_date: '2027-01-01', hasPaidBefore: true }, st, T)).toMatchObject({ phase: 'suspended_admin', hasAccess: false })
  })
  it('prueba: normal, por terminar (límite del aviso) y vencida sin gracia', () => {
    expect(ph({ status: 'trial', end_date: '2026-11-10' }, st, T).phase).toBe('trial')
    expect(ph({ status: 'trial', end_date: '2026-10-24' }, st, T)).toMatchObject({ phase: 'trial_ending', daysToEnd: 5, hasAccess: true })
    expect(ph({ status: 'trial', end_date: '2026-10-25' }, st, T).phase).toBe('trial')
    expect(ph({ status: 'trial', end_date: T }, st, T)).toMatchObject({ phase: 'trial_ending', daysToEnd: 0, hasAccess: true })
    expect(ph({ status: 'trial', end_date: '2026-10-18', hasPaidBefore: true }, st, T)).toMatchObject({ phase: 'lapsed', hasAccess: false })
  })
  it('activa: automática, manual y renovación cancelada por el usuario', () => {
    expect(ph({ status: 'active', end_date: '2026-11-20', autoRenewal: true }, st, T).phase).toBe('active_auto')
    expect(ph({ status: 'active', end_date: '2026-11-20' }, st, T).phase).toBe('active_manual')
    expect(ph({ status: 'active', end_date: '2026-11-20', renewalCancelled: true }, st, T)).toMatchObject({ phase: 'renewal_off', hasAccess: true })
  })
  it('pago fallido dentro del período conserva acceso', () => {
    expect(ph({ status: 'past_due', end_date: '2026-10-25', hasPaidBefore: true }, st, T)).toMatchObject({ phase: 'payment_failed', hasAccess: true })
  })
  it('gracia: solo con pago previo, hasta end_date + graceDays inclusive', () => {
    const base = { status: 'past_due', hasPaidBefore: true }
    expect(ph({ ...base, end_date: '2026-10-18' }, st, T)).toMatchObject({ phase: 'grace', hasAccess: true, graceEndsOn: '2026-10-23' })
    expect(ph({ ...base, end_date: '2026-10-14' }, st, T)).toMatchObject({ phase: 'grace', hasAccess: true }) // día 5
    expect(ph({ ...base, end_date: '2026-10-13' }, st, T)).toMatchObject({ phase: 'lapsed', hasAccess: false }) // día 6
    expect(ph({ status: 'active', end_date: '2026-10-17', hasPaidBefore: true }, st, T).phase).toBe('grace') // renovación aún no registrada
  })
  it('SIN gracia: nunca pagó (usuario sin prueba creado past_due), cancelado por el usuario, graceDays=0', () => {
    expect(ph({ status: 'past_due', end_date: '2026-10-18', hasPaidBefore: false }, st, T)).toMatchObject({ phase: 'lapsed', hasAccess: false })
    expect(ph({ status: 'past_due', end_date: '2026-10-18' }, st, T).hasAccess).toBe(false)
    expect(ph({ status: 'cancelled', end_date: '2026-10-18', hasPaidBefore: true }, st, T).phase).toBe('lapsed')
    expect(ph({ status: 'past_due', end_date: '2026-10-18', hasPaidBefore: true }, { ...st, graceDays: 0 }, T).phase).toBe('lapsed')
  })
  it('cancelada con período vigente y estados desconocidos', () => {
    expect(ph({ status: 'cancelled', end_date: '2026-11-01' }, st, T)).toMatchObject({ phase: 'cancelled_end', hasAccess: true })
    expect(ph({ status: 'raro', end_date: '2030-01-01' }, st, T).hasAccess).toBe(false)
  })
  it('activa sin fecha (histórico) conserva acceso; otras no', () => {
    expect(ph({ status: 'active', end_date: null }, st, T)).toMatchObject({ hasAccess: true, daysToEnd: null })
    expect(ph({ status: 'trial', end_date: null }, st, T).hasAccess).toBe(false)
  })
})
describe('compatibilidad con hasAccess actual (graceDays=0)', () => {
  it('coincide en todas las combinaciones de estado y fecha', () => {
    const statuses = ['trial', 'active', 'past_due', 'suspended', 'cancelled', 'otro']
    const dates = [null, '2026-10-01', '2026-10-18', T, '2026-10-20', '2027-01-01']
    for (const status of statuses) for (const end_date of dates)
      expect(ph({ status, end_date, hasPaidBefore: true }, { noticeDays: 5, graceDays: 0 }, T).hasAccess, `${status} ${end_date}`).toBe(hasAccess({ status, end_date }, T))
  })
})

// Reglas confirmadas en etapa 6c: sin gracia al terminar la prueba; cobro fallido -> gracia -> sin acceso.
describe('reglas de etapa 6c', () => {
  const T = '2026-11-10'
  it('prueba vencida sin pago: sin acceso desde el día siguiente (aunque haya gracia configurada)', () => {
    const r = ph({ status: 'trial', end_date: '2026-11-09', hasPaidBefore: false }, { noticeDays: 5, graceDays: 5 }, T)
    expect(r.phase).toBe('lapsed'); expect(r.hasAccess).toBe(false)
  })
  it('activa con cobro fallido: gracia y luego sin acceso', () => {
    const s = { status: 'active', end_date: '2026-11-05', hasPaidBefore: true }
    expect(ph(s, { noticeDays: 5, graceDays: 5 }, '2026-11-10')).toMatchObject({ phase: 'grace', hasAccess: true, graceEndsOn: '2026-11-10' })
    expect(ph(s, { noticeDays: 5, graceDays: 5 }, '2026-11-11')).toMatchObject({ phase: 'lapsed', hasAccess: false })
  })
  it('past_due vencida con pago previo: misma gracia', () => {
    expect(ph({ status: 'past_due', end_date: '2026-11-08', hasPaidBefore: true }, { noticeDays: 5, graceDays: 5 }, T).phase).toBe('grace')
  })
})

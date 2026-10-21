import { describe, it, expect } from 'vitest'
import { PLAN_PERIODS, isPlanPeriod, periodMonths, periodAdjective, periodUnit } from './plan-period'

describe('plan-period', () => {
  it('meses por período', () => {
    expect(PLAN_PERIODS.map(periodMonths)).toEqual([1, 3, 6, 12])
  })
  it('un valor desconocido falla (no se asume mensual ni anual)', () => {
    for (const bad of ['weekly', '', null, undefined, 3, 'Monthly']) expect(() => periodMonths(bad)).toThrow(/no soportado/)
    expect(isPlanPeriod('quarterly')).toBe(true); expect(isPlanPeriod('weekly')).toBe(false)
  })
  it('textos en español', () => {
    expect(PLAN_PERIODS.map(periodAdjective)).toEqual(['mensual', 'trimestral', 'semestral', 'anual'])
    expect(PLAN_PERIODS.map(periodUnit)).toEqual(['mes', '3 meses', '6 meses', 'año'])
  })
  it('textos con valor desconocido: vacío, sin romper la pantalla', () => {
    expect(periodUnit('x')).toBe(''); expect(periodAdjective(undefined)).toBe('')
  })
})

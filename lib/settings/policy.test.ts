import { describe, it, expect } from 'vitest'
import { settingsFromRows, parsePolicyForm } from './policy'

const fd = (o: Record<string, string>) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.set(k, v)); return f }
describe('settingsFromRows', () => {
  it('lee los valores guardados', () => expect(settingsFromRows([{ key: 'notice_days', value: 7 }, { key: 'grace_days', value: 3 }])).toEqual({ noticeDays: 7, graceDays: 3 }))
  it('usa valores iniciales ante filas ausentes, basura o error', () => {
    expect(settingsFromRows([])).toEqual({ noticeDays: 5, graceDays: 5 })
    expect(settingsFromRows(null)).toEqual({ noticeDays: 5, graceDays: 5 })
    expect(settingsFromRows([{ action: 'mp_reconcile_run' }, null, { key: 'grace_days', value: 'x' }])).toEqual({ noticeDays: 5, graceDays: 5 })
  })
})
describe('parsePolicyForm', () => {
  it('acepta valores dentro de rango, incluida gracia 0', () => {
    expect(parsePolicyForm(fd({ notice_days: '5', grace_days: '0' }))).toEqual({ ok: true, value: { noticeDays: 5, graceDays: 0 } })
    expect(parsePolicyForm(fd({ notice_days: '15', grace_days: '30' })).ok).toBe(true)
  })
  it.each([['0', '5'], ['16', '5'], ['5', '31'], ['5', '-1'], ['5.5', '5'], ['abc', '5'], ['', '5'], ['5', ''], ['1e1', '5']])('rechaza aviso=%s gracia=%s', (n, g) => {
    expect(parsePolicyForm(fd({ notice_days: n, grace_days: g })).ok).toBe(false)
  })
})

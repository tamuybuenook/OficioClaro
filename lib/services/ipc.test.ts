import { describe, it, expect } from 'vitest'
import { targetEffectiveDate } from './ipc'

describe('targetEffectiveDate', () => {
  it('IPC publicado en septiembre impacta la lista de octubre (Bloque 0, sección 9)', () => {
    expect(targetEffectiveDate('2026-09-10')).toEqual({ date: '2026-10-01', label: 'Octubre 2026' })
  })
  it('cruza de año: publicado en diciembre impacta enero del año siguiente', () => {
    expect(targetEffectiveDate('2026-12-05')).toEqual({ date: '2027-01-01', label: 'Enero 2027' })
  })
  it('usa el mes de publicación, no el período del IPC', () => {
    // Un IPC de agosto publicado recién en octubre debe impactar noviembre, no octubre.
    expect(targetEffectiveDate('2026-10-15')).toEqual({ date: '2026-11-01', label: 'Noviembre 2026' })
  })
})

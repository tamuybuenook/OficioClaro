import { describe, it, expect } from 'vitest'
import { buildBanner, type NotificationRow } from './banner'
import type { AccessView } from '@/lib/subscription-notice'

const acc = (o: Partial<AccessView> = {}): AccessView => ({ phase: 'active_manual', locked: false, daysToEnd: 20, graceEndsOn: null, endDate: '2026-11-30', subStatus: 'active', ...o })
const row = (o: Partial<NotificationRow> = {}): NotificationRow => ({ id: 'n1', kind: 'manual_due_soon', severity: 'warning', due_date: '2026-11-30', payload: { end_date: '2026-11-30', days: 3 }, ...o })

describe('buildBanner', () => {
  it('bloqueado: siempre el aviso de bloqueo, aunque haya otros avisos', () => {
    const b = buildBanner(acc({ phase: 'lapsed', locked: true, subStatus: 'trial' }), [row({ kind: 'payment_confirmed', severity: 'info' })])
    expect(b).toMatchObject({ id: null, tone: 'danger', dismissible: false }); expect(b?.text).toMatch(/prueba gratuita terminó/)
  })
  it('sin poder leer avisos (null): cae al aviso calculado por fase (6c)', () => {
    expect(buildBanner(acc({ phase: 'payment_failed', subStatus: 'past_due', endDate: '2026-11-12', daysToEnd: 2 }), null)).toMatchObject({ id: null, tone: 'warning', dismissible: false })
    expect(buildBanner(acc(), null)).toBeNull()
  })
  it('sin avisos abiertos: sin banner', () => { expect(buildBanner(acc(), [])).toBeNull() })
  it('elige el de mayor prioridad', () => {
    const b = buildBanner(acc(), [row({ id: 'a', kind: 'payment_confirmed', severity: 'info' }), row({ id: 'b', kind: 'grace_period', payload: { end_date: '2026-11-08', grace_ends_on: '2026-11-13' } })])
    expect(b?.id).toBe('b'); expect(b?.dismissible).toBe(false)
  })
  it('solo el informativo se puede descartar', () => {
    const b = buildBanner(acc(), [row({ id: 'p', kind: 'payment_confirmed', severity: 'info', payload: { end_date: '2026-12-30' } })])
    expect(b).toMatchObject({ id: 'p', tone: 'info', dismissible: true }); expect(b?.text).toMatch(/30\/12\/2026/)
  })
  it('ignora tipos desconocidos (p. ej. avisos de funciones futuras) sin romperse', () => {
    expect(buildBanner(acc(), [row({ kind: 'algo_nuevo' })])).toBeNull()
    expect(buildBanner(acc(), [row({ kind: 'algo_nuevo' }), row({ id: 'ok' })])?.id).toBe('ok')
  })
  it('severidad desconocida se muestra como informativa', () => { expect(buildBanner(acc(), [row({ severity: 'x' })])?.tone).toBe('info') })
})

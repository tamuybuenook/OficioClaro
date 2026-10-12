import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mulRound2, round2, applyPercent } from './money'

describe('mulRound2 (misma regla que PostgreSQL round(a*b, 2))', () => {
  it('medio centavo: 0,001 × 5,50 = 0,01', () => {
    expect(mulRound2(0.001, 5.5)).toBe(0.01)
  })
  it('caso clásico donde el redondeo con floats falla (1,005 -> 1,01)', () => {
    expect(Math.round(1.005 * 100) / 100).toBe(1) // comportamiento anterior (incorrecto respecto de Postgres)
    expect(round2(1.005)).toBe(1.01)
  })
  it('ejemplos del dominio (UT 39000)', () => {
    expect(mulRound2(10, 39000)).toBe(390000)
    expect(mulRound2(2.83, 39000)).toBe(110370)
    expect(mulRound2(3.4, 39000)).toBe(132600)
    expect(mulRound2(3.8, 39000)).toBe(148200)
  })
  it('half away from zero', () => {
    expect(mulRound2(2.835, 100)).toBe(283.5)
    expect(mulRound2(0.005, 1)).toBe(0.01)
    expect(mulRound2(-0.005, 1)).toBe(-0.01)
  })
  it('coincide con 400+ vectores generados por PostgreSQL', () => {
    const lines = readFileSync(new URL('./money.vectors.csv', import.meta.url), 'utf8').trim().split('\n')
    expect(lines.length).toBeGreaterThan(400)
    for (const line of lines) {
      const [c, u, expected] = line.split(',')
      expect(mulRound2(c, u), `${c} × ${u}`).toBe(Number(expected))
    }
  })
})

describe('applyPercent (IPC sobre el precio anterior)', () => {
  it('85000 con 1,7% = 86445 (el valor observado en la base de pruebas)', () => {
    expect(applyPercent(85000, 1.7)).toBe(86445)
  })
  it('390000 con 2,5% = 399750', () => expect(applyPercent(390000, 2.5)).toBe(399750))
  it('round2', () => expect(round2(1.005)).toBe(1.01))
})

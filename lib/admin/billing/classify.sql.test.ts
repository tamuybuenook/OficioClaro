// Paridad contra PostgreSQL REAL: los filtros del listado (applyCategoryFilter) traducidos a SQL deben elegir exactamente
// las filas que classifyPayment clasifica, con la lógica de tres valores de SQL (NULL). Se omite si no hay Postgres local
// (el de supabase/tests/run_baseline.sh, puerto 5433).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { applyCategoryFilter, classifyPayment, CATEGORIES, type FilterBuilder } from './classify'

const PSQL = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-q']
function pgUp() { try { execFileSync('psql', [...PSQL, '-c', 'select 1'], { stdio: 'pipe' }); return true } catch { return false } }
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

class SqlQuery implements FilterBuilder<SqlQuery> {
  where: string[] = []
  eq(c: string, v: string) { this.where.push(`${c} = ${lit(v)}`); return this }
  is(c: string, _v: null) { this.where.push(`${c} is null`); return this }
  not(c: string, op: string, _v: null) { if (op !== 'is') throw new Error('op'); this.where.push(`${c} is not null`); return this }
  or(expr: string) {
    const parts = expr.split(',').map((x) => {
      const m = x.match(/^(\w+)\.(eq|neq|is|not\.is)\.(.*)$/); if (!m) throw new Error(x)
      const [, col, op, val] = m
      return op === 'eq' ? `${col} = ${lit(val)}` : op === 'neq' ? `${col} <> ${lit(val)}` : op === 'is' ? `${col} is null` : `${col} is not null`
    })
    this.where.push(`(${parts.join(' or ')})`); return this
  }
  sql() { return this.where.length ? this.where.join(' and ') : 'true' }
}

describe.skipIf(!pgUp())('filtros del listado en PostgreSQL real', () => {
  it('cada combinación de columnas cae en la misma categoría que classifyPayment', () => {
    const rows: any[] = []
    let n = 0
    for (const status of ['pending', 'reconciled', 'rejected', 'refunded'])
      for (const provider of ['mercadopago', 'transfer'])
        for (const applied_at of [null, '2026-10-01T00:00:00Z'])
          for (const review_reason of [null, 'subscription_suspended', 'subscription_cancelled'])
            for (const review_resolution of [null, 'applied', 'refund_pending', 'refunded'])
              rows.push({ id: ++n, status, provider, applied_at, review_reason, review_resolution })
    const q = (v: string | null) => (v === null ? 'null' : lit(v))
    const values = rows.map((r) => `(${r.id},${q(r.status)},${q(r.provider)},${r.applied_at ? "'2026-10-01T00:00:00Z'::timestamptz" : 'null::timestamptz'},${q(r.review_reason)},${q(r.review_resolution)})`).join(',')
    const stmts = [`create temp table p(id int, status text, provider text, applied_at timestamptz, review_reason text, review_resolution text);`, `insert into p values ${values};`]
    for (const c of CATEGORIES) stmts.push(`select '${c}|' || coalesce(string_agg(id::text, ',' order by id), '') from p where ${applyCategoryFilter(new SqlQuery(), c).sql()};`)
    const out = execFileSync('psql', [...PSQL], { input: stmts.join('\n'), encoding: 'utf8' }).trim().split('\n')
    const got = new Map(out.filter((l) => l.includes('|')).map((l) => { const [c, ids] = l.split('|'); return [c, ids ? ids.split(',').map(Number) : []] as const }))
    for (const c of CATEGORIES) {
      const expected = rows.filter((r) => classifyPayment(r) === c).map((r) => r.id)
      expect(got.get(c), c).toEqual(expected)
    }
    // Sin solapamientos ni filas huérfanas.
    const all = CATEGORIES.flatMap((c) => got.get(c) ?? [])
    expect(new Set(all).size).toBe(rows.length); expect(all.length).toBe(rows.length)
  })
})

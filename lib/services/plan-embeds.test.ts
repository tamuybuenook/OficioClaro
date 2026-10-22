// Protege contra el error «Sin plan»: `subscriptions` tiene DOS claves hacia `plans` (plan_id y mp_plan_id, migración 0023),
// así que `plans(...)` solo es ambiguo para PostgREST y la consulta falla. Debe escribirse `plans!plan_id(...)`.
// Prueba estática (lee el código fuente): no necesita base ni red. NO reemplaza probar contra Supabase real.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name)
    const st = statSync(join(ROOT, rel))
    if (st.isDirectory()) { if (!['node_modules', '.next'].includes(name)) sources(rel, out) }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}

/** Hallazgos: textos de select() que piden `plans(` sin pista desde `subscriptions` (directo o anidado). */
export function ambiguousPlanEmbeds(src: string): string[] {
  const found: string[] = []
  // a) .from('subscriptions') ... .select('…plans(…')
  for (const m of src.matchAll(/\.from\('subscriptions'\)[\s\S]{0,300}?\.select\((['"`])([\s\S]*?)\1/g)) if (/(^|[^!\w])plans\(/.test(m[2])) found.push(m[2])
  // b) anidado: subscriptions(…, plans(…)) dentro de otro select (p. ej. desde payments)
  for (const m of src.matchAll(/(['"`])((?:(?!\1)[\s\S])*?\bsubscriptions\([^)]*\bplans\((?:(?!\1)[\s\S])*?)\1/g)) found.push(m[2])
  return found
}

describe('consultas hacia plans desde subscriptions (error «Sin plan»)', () => {
  it('el detector marca la forma ambigua y acepta la forma con pista', () => {
    expect(ambiguousPlanEmbeds(`supabase.from('subscriptions').select('*, plans(*)')`)).toHaveLength(1)
    expect(ambiguousPlanEmbeds(`.select('*, plan:plans!plan_id(name), subscriptions(plan_id, plans(name))')`)).toHaveLength(1)
    expect(ambiguousPlanEmbeds(`supabase.from('subscriptions').select('*, plans!plan_id(*)')`)).toHaveLength(0)
    expect(ambiguousPlanEmbeds(`.select('x, subscriptions(plan_id, plans!plan_id(name))')`)).toHaveLength(0)
    expect(ambiguousPlanEmbeds(`.from('payments').select('x, plans(name), subscriptions(user_id, profiles(full_name))')`)).toHaveLength(0) // payments→plans tiene una sola clave
  })
  it('ningún archivo de app/ ni lib/ pide plans(…) ambiguo desde subscriptions', () => {
    const bad: Record<string, string[]> = {}
    for (const f of [...sources('app'), ...sources('lib'), ...sources('components')]) {
      const hits = ambiguousPlanEmbeds(readFileSync(join(ROOT, f), 'utf8'))
      if (hits.length) bad[f] = hits
    }
    expect(bad).toEqual({})
  })
  it('las lecturas que alimentan la pantalla usan la pista explícita', () => {
    expect(readFileSync(join(ROOT, 'lib/services/subscriptions.ts'), 'utf8')).toContain('plans!plan_id(*)')
    expect(readFileSync(join(ROOT, 'lib/services/payments.ts'), 'utf8')).toContain('plans!plan_id(name)')
    expect(readFileSync(join(ROOT, 'app/admin/suscripciones/page.tsx'), 'utf8')).toContain('plans!plan_id(name)')
  })
})

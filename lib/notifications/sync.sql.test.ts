// Contrato TypeScript <-> SQL contra PostgreSQL REAL: lo que arma desiredNotifications debe ser aceptado por
// public.sync_notifications (migración 0033). Corre solo si existe la base local `oc_notif` con 0033 aplicada
// (supabase/tests/run_notifications.sh, puerto 5433). Todo ocurre dentro de una transacción que se deshace.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { desiredNotifications, NOTIFICATION_KINDS, type RulesInput } from './rules'

const PSQL = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'oc_notif', '-X', '-A', '-t', '-q']
function ready() { try { return execFileSync('psql', [...PSQL, '-c', "select to_regclass('public.sync_notifications') is null and to_regproc('public.sync_notifications') is null"], { stdio: 'pipe', encoding: 'utf8' }).trim() === 'f' } catch { return false } }

const SID = '22222222-2222-4222-8222-222222222222'
const UID = '00000000-0000-0000-0000-0000000000f1'
const base: RulesInput = { subscriptionId: SID, phase: 'active_manual', daysToEnd: 3, graceEndsOn: null, endDate: '2026-11-30', subStatus: 'active', noticeDays: 5, lastPayment: null, today: '2026-11-10' }
const variants: Partial<RulesInput>[] = [
  { phase: 'trial_ending', subStatus: 'trial' }, { phase: 'active_auto' }, { phase: 'renewal_off' }, { phase: 'active_manual' },
  { phase: 'payment_failed', subStatus: 'past_due' }, { phase: 'grace', daysToEnd: -2, endDate: '2026-11-08', graceEndsOn: '2026-11-13' },
  { phase: 'lapsed', daysToEnd: -9, endDate: '2026-11-01' }, { phase: 'lapsed', daysToEnd: -1, subStatus: 'trial', endDate: '2026-11-09' },
  { phase: 'trial', lastPayment: { id: '33333333-3333-4333-8333-333333333333', date: '2026-11-09' } }, { phase: 'payment_failed', endDate: null },
]

describe.skipIf(!ready())('avisos: TypeScript contra la función SQL real', () => {
  it('la base acepta los avisos de todas las fases, sin duplicar al repetir', () => {
    const all = variants.flatMap((v) => desiredNotifications({ ...base, ...v }))
    const unique = [...new Map(all.map((d) => [d.dedupe_key, d])).values()]
    expect(new Set(unique.map((d) => d.kind))).toEqual(new Set(NOTIFICATION_KINDS)) // cubre los 8 tipos
    const json = JSON.stringify(unique).replace(/'/g, "''")
    const sql = [
      'begin;',
      `insert into auth.users(id,email,email_confirmed_at) values ('${UID}','sqltest@t.com',now());`,
      `select 'R1=' || sync_notifications('${UID}', '${json}'::jsonb)::text;`,
      `select 'R2=' || sync_notifications('${UID}', '${json}'::jsonb)::text;`,
      `select 'N=' || count(*) || '|' || count(*) filter (where status = 'open') || '|' || count(*) filter (where source = 'payment') from public.notifications where user_id = '${UID}';`,
      'rollback;',
    ].join('\n')
    const out = execFileSync('psql', PSQL, { input: sql, encoding: 'utf8' }).split('\n')
    const get = (p: string) => out.find((l) => l.startsWith(p))!.slice(p.length)
    expect(JSON.parse(get('R1='))).toEqual({ created: unique.length, reopened: 0, resolved: 0 })
    expect(JSON.parse(get('R2='))).toEqual({ created: 0, reopened: 0, resolved: 0 })
    expect(get('N=')).toBe(`${unique.length}|${unique.length}|1`)
  })
})

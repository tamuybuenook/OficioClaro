import { describe, it, expect, vi, beforeEach } from 'vitest'

const st = { admin: true, user: true, updates: [] as any[], audits: [] as any[], failKey: null as string | null }
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/assert-admin', () => ({
  cleanDbError: (m: string) => m,
  getAdminContext: async () => {
    if (!st.user) return { error: 'No autenticado' }
    if (!st.admin) return { error: 'Solo un administrador puede realizar esta acción.' }
    return {
      user: { id: 'adm' },
      supabase: {
        from: (t: string) => t === 'audit_logs'
          ? { insert: async (r: any) => { st.audits.push(r); return { error: null } } }
          : { select: async () => ({ data: [{ key: 'notice_days', value: 5 }, { key: 'grace_days', value: 5 }], error: null }),
              update: (patch: any) => ({ eq: async (_c: string, key: string) => { if (st.failKey === key) return { error: { message: 'boom' } }; st.updates.push({ key, ...patch }); return { error: null } } }) },
      },
    }
  },
}))

import { updateSubscriptionPolicy } from './appSettings'
const fd = (o: Record<string, string>) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.set(k, v)); return f }
beforeEach(() => Object.assign(st, { admin: true, user: true, updates: [], audits: [], failKey: null }))

describe('updateSubscriptionPolicy', () => {
  it('un no-admin no escribe nada', async () => {
    st.admin = false
    expect(await updateSubscriptionPolicy(fd({ notice_days: '5', grace_days: '5' }))).toEqual({ error: expect.stringMatching(/administrador/) })
    expect(st.updates).toEqual([]); expect(st.audits).toEqual([])
  })
  it('valores fuera de rango no escriben', async () => {
    expect(await updateSubscriptionPolicy(fd({ notice_days: '99', grace_days: '5' }))).toEqual({ error: expect.any(String) })
    expect(st.updates).toEqual([])
  })
  it('guarda ambos valores y deja registro de auditoría con antes/después', async () => {
    expect(await updateSubscriptionPolicy(fd({ notice_days: '7', grace_days: '3' }))).toBeUndefined()
    expect(st.updates).toEqual([{ key: 'notice_days', value: 7 }, { key: 'grace_days', value: 3 }])
    expect(st.audits[0]).toMatchObject({ actor_id: 'adm', entity: 'app_settings', old_value: { noticeDays: 5, graceDays: 5 }, new_value: { noticeDays: 7, graceDays: 3 } })
  })
  it('si falla la segunda escritura lo informa y no audita como éxito', async () => {
    st.failKey = 'grace_days'
    expect(await updateSubscriptionPolicy(fd({ notice_days: '7', grace_days: '3' }))).toEqual({ error: expect.stringMatching(/falló la gracia/) })
    expect(st.audits).toEqual([])
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const st = { user: { id: 'u1' } as any, resetErr: null as any, updateErr: null as any, resetArgs: null as any, updated: null as any, signedOut: false }
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => 'https://origen.test' }) }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }) } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: st.user } }),
      resetPasswordForEmail: async (email: string, opts: any) => { st.resetArgs = { email, opts }; return { error: st.resetErr } },
      updateUser: async (a: any) => { st.updated = a; return { error: st.updateErr } },
      signOut: async () => { st.signedOut = true },
    },
  }),
}))

import { requestPasswordReset, updatePassword } from './auth'

const fd = (o: Record<string, string>) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.set(k, v)); return f }
const redirectTo = async (p: Promise<any>) => { try { await p } catch (e: any) { return e.to } return null }

beforeEach(() => { Object.assign(st, { user: { id: 'u1' }, resetErr: null, updateErr: null, resetArgs: null, updated: null, signedOut: false }); delete process.env.APP_URL })

describe('requestPasswordReset', () => {
  it('rechaza correos vacíos o inválidos sin llamar a Supabase', async () => {
    expect(await requestPasswordReset(fd({ email: '' }))).toEqual({ error: expect.any(String) })
    expect(await requestPasswordReset(fd({ email: 'sin-arroba' }))).toEqual({ error: expect.any(String) })
    expect(st.resetArgs).toBeNull()
  })
  it('usa APP_URL para el enlace y vuelve con sent=1', async () => {
    process.env.APP_URL = 'https://oficioclaro.vercel.app/'
    expect(await redirectTo(requestPasswordReset(fd({ email: 'a@b.com' })))).toBe('/forgot-password?sent=1')
    expect(st.resetArgs.opts.redirectTo).toBe('https://oficioclaro.vercel.app/auth/callback?next=/reset-password')
  })
  it('responde igual aunque Supabase falle (no revela si el correo existe)', async () => {
    st.resetErr = { status: 400, code: 'user_not_found' }
    expect(await redirectTo(requestPasswordReset(fd({ email: 'nadie@b.com' })))).toBe('/forgot-password?sent=1')
  })
})

describe('updatePassword', () => {
  it('valida longitud y coincidencia', async () => {
    expect(await updatePassword(fd({ password: '123', confirm: '123' }))).toEqual({ error: expect.stringMatching(/6 caracteres/) })
    expect(await updatePassword(fd({ password: 'abcdef', confirm: 'abcdeg' }))).toEqual({ error: expect.stringMatching(/no coinciden/) })
    expect(st.updated).toBeNull()
  })
  it('sin sesión de recuperación (enlace vencido) no cambia nada', async () => {
    st.user = null
    expect(await updatePassword(fd({ password: 'abcdef', confirm: 'abcdef' }))).toEqual({ error: expect.stringMatching(/venció/) })
    expect(st.updated).toBeNull()
  })
  it('cambia la contraseña, cierra sesión y vuelve al login', async () => {
    expect(await redirectTo(updatePassword(fd({ password: 'abcdef', confirm: 'abcdef' })))).toBe('/login?reset=ok')
    expect(st.updated).toEqual({ password: 'abcdef' }); expect(st.signedOut).toBe(true)
  })
  it('traduce el error de contraseña repetida', async () => {
    st.updateErr = { code: 'same_password' }
    expect(await updatePassword(fd({ password: 'abcdef', confirm: 'abcdef' }))).toEqual({ error: expect.stringMatching(/distinta/) })
    expect(st.signedOut).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { isPublicPath, safeNext } from './paths'

describe('isPublicPath', () => {
  it.each(['/', '/login', '/register', '/forgot-password', '/reset-password', '/auth/confirm', '/auth/callback'])('%s es pública', (p) => expect(isPublicPath(p)).toBe(true))
  it.each(['/admin', '/agenda', '/loginx', '/authx/confirm', '/reset-password-evil', '/perfil'])('%s requiere sesión', (p) => expect(isPublicPath(p)).toBe(false))
})
describe('safeNext', () => {
  it('acepta rutas permitidas', () => { expect(safeNext('/reset-password')).toBe('/reset-password'); expect(safeNext('/')).toBe('/') })
  it.each([null, undefined, '', 'https://evil.com', '//evil.com', '/admin', '/\\evil.com', 'javascript:alert(1)'])('rechaza %s', (v) => expect(safeNext(v as any)).toBe('/'))
})

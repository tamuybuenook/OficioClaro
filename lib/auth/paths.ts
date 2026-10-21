// Rutas que se pueden abrir sin sesión (login, registro, recuperación y los enlaces de email/OAuth).
const PUBLIC_PREFIXES = ['/login', '/register', '/forgot-password', '/reset-password', '/auth/']

export function isPublicPath(pathname: string): boolean {
  return pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/'))
}

// Destino posterior a un enlace de email. Solo rutas internas conocidas: evita open redirect.
const ALLOWED_NEXT = ['/', '/reset-password']
export function safeNext(next: string | null | undefined): string {
  return next && ALLOWED_NEXT.includes(next) ? next : '/'
}

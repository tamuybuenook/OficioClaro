# Cierre — Etapa 2/3: Recuperación de contraseña

## Cambios
- `lib/supabase/middleware.ts`: rutas públicas vía `isPublicPath` (antes `/auth/*` y las nuevas rutas redirigían a /login sin sesión).
- `lib/auth/paths.ts` (+test): `isPublicPath`, `safeNext` (solo `/` y `/reset-password`; evita open redirect).
- `lib/auth/messages.ts`: mensaje genérico (no revela si el correo existe).
- `lib/actions/auth.ts`: `requestPasswordReset`, `updatePassword` (+ `auth.test.ts`).
- `app/forgot-password`, `app/reset-password`: pantallas nuevas.
- `app/auth/confirm` y `app/auth/callback`: soportan recuperación; enlace inválido → `/forgot-password?error=link`.
- `app/login/page.tsx`: enlace «Olvidé mi contraseña» y aviso «Contraseña actualizada».
- `components/auth/password-field.tsx`: prop `name` (compatible hacia atrás).

## Pruebas ejecutadas (entorno de desarrollo, no producción)
- `pnpm typecheck`: sin errores.
- `pnpm test`: 23 archivos pasan, 309 tests OK (1 omitido ya existente). Nuevos: 22 en paths, 7 en auth.
- `pnpm build` (variables ficticias): compila; rutas nuevas presentes.

## Pendiente (requiere Supabase real)
1. Prueba manual del correo real (ver pasos abajo).
2. Verificar que Google login sigue funcionando (el middleware cambió).
3. Límite de pedidos de correo: lo aplica Supabase; no se agregó límite propio.
4. Mínimo de contraseña 6 (igual que registro). Revisar en Supabase → Auth → Providers → Email.

## Configuración en Supabase (Authentication → URL Configuration)
- Site URL: `https://oficioclaro.vercel.app`
- Redirect URLs: `https://oficioclaro.vercel.app/auth/callback` y `http://localhost:3000/auth/callback`
- Vercel: variable `APP_URL=https://oficioclaro.vercel.app` (sin barra final).
- Opcional (recomendado en celular, funciona si el correo se abre en otro navegador/app):
  Authentication → Email Templates → *Reset Password*, cambiar el enlace por:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`

## Prueba manual (5 min)
1. /login → «Olvidé mi contraseña» → email registrado → mensaje de envío.
2. Repetir con email inexistente → mismo mensaje.
3. Abrir el enlace del correo → pantalla «Creá tu nueva contraseña».
4. Contraseñas distintas → error. Iguales → vuelve a /login con aviso verde.
5. Ingresar con la nueva. Reusar el mismo enlace → «Enlace no válido».
6. Probar login normal, registro y «Continuar con Google».

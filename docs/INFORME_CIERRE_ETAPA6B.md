# Cierre — Etapa 6b: política de suscripciones configurable
## Cambios
- **Migración nueva (NO aplicada):** `supabase/migrations/0031_app_settings.sql`. Tabla `app_settings` con claves cerradas `notice_days` (1–15) y `grace_days` (0–30), valores iniciales 5/5, RLS (lectura autenticados; solo admin actualiza `value`), autor/fecha forzados por trigger. Aditiva: no toca 0001–0030.
- `lib/settings/policy.ts` (+test): lectura tolerante (valores iniciales si falta/falla) y validación estricta.
- `lib/actions/appSettings.ts` (+test): `updateSubscriptionPolicy` (solo admin, valida, registra antes/después en `audit_logs`).
- `components/admin/policy-form.tsx` y `app/admin/configuracion/page.tsx`: sección «Política de suscripciones».
Diferencia con el diseño: valores `integer` con CHECK en vez de `jsonb` (más simple y validado por la base).
## Pruebas ejecutadas
`pnpm typecheck` OK · `pnpm test` 26 archivos / 336 tests OK (16 nuevos) · `pnpm build` (variables ficticias) ver resultado en el chat.
## NO probado
- **La migración SQL no se ejecutó** (no hay PostgreSQL en el entorno de Claude). Sin pruebas SQL de RLS.
- Sin prueba en navegador ni contra Supabase real.
## Cómo aplicar (vos, primero en un proyecto de PRUEBA)
1. Copiar los archivos del ZIP al proyecto.
2. Supabase → SQL Editor → pegar `0031_app_settings.sql` → Run.
3. Verificar: `select * from app_settings;` → 2 filas (5 y 5).
4. Entrar como admin a `/admin/configuracion`, cambiar valores, guardar; recargar y comprobar que persisten; revisar `select * from audit_logs where entity='app_settings' order by created_at desc;`.
5. Con un usuario NO admin, en SQL Editor o por la app, un `update app_settings` debe fallar o no afectar filas.
Si algo falla, borrar con: `drop table public.app_settings cascade; drop function public.app_settings_stamp();` (la app seguirá funcionando con valores iniciales).
## Pendiente
6c (usar la fase y la gracia en servidor y UI), no iniciado.

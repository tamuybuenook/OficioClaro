# Cierre — Etapa 7a: tabla de avisos, reglas y sincronización (sin pantalla todavía)

## Qué se hizo
- **Migración `0033_notifications.sql` (NO aplicada):** tabla `notifications` (clave única `dedupe_key`; estados open/dismissed/resolved; columnas de correo para la etapa 8, hoy sin uso), RLS (el usuario solo LEE lo suyo; el admin lee todo; nadie escribe directo) y dos funciones:
  - `sync_notifications(usuario, lista)`: solo `service_role`. Atómica e idempotente: crea los que faltan, **reabre** los resueltos que vuelven a corresponder (nunca los descartados), resuelve los que ya no corresponden, no toca los campos de correo. Bloqueo por usuario para dos ejecuciones simultáneas.
  - `dismiss_notification(id)`: el dueño descarta solo avisos **informativos** (`payment_confirmed`).
  - Sin clave foránea a `subscriptions` (no interfiere con las guardas de borrado 0027–0030). Al borrar al usuario se borran sus avisos.
- **`lib/notifications/rules.ts`** (pura, 14 tests): qué avisos corresponden según la fase. Los 8 del diseño: `trial_ending`, `auto_charge_upcoming`, `renewal_not_authorized`, `payment_failed`, `manual_due_soon`, `grace_period`, `suspended_nonpayment` (con motivo `trial_ended` o `unpaid`), `payment_confirmed` (7 días). Los de «próximo vencimiento» solo aparecen dentro de la ventana de aviso configurada. Prioridad para el banner: suspensión > gracia > pago fallido > avisos > informativos.
- **`lib/notifications/sync.ts`** (9 tests): calcula la fase con `computeAccess` (ahora reutilizable: `lib/services/access.ts` se refactorizó sin cambiar su comportamiento) y sincroniza; **si no puede leer datos no escribe** (un error técnico nunca cierra avisos vigentes); si la base ya coincide, no escribe; nunca lanza.
- No hay cambios de pantalla ni llamadas desde la página: eso es 7b.

## Pruebas ejecutadas (reales)
- `tsc` sin errores · `vitest`: 34 archivos, 397 tests OK · `next build` compila.
- PostgreSQL 16 local con migraciones 0001–0033: `06_notifications.sql` **26/26** (permisos, idempotencia, reapertura, descarte, aislamiento entre usuarios, claves ajenas, límites de entrada, borrado del usuario). Carrera: 8 sincronizaciones simultáneas del mismo usuario dejan 1 sola fila, sin errores.
- Sin regresiones: 01 (94), 03 (222), 04 (21), 05 (19).

## NO probado
- Contra Supabase real. La función usa `service_role` (ya configurada en Vercel para el webhook).
- Nada visible en pantalla todavía.

## Cómo aplicar (proyecto de PRUEBA primero)
1. Descomprimir el ZIP sobre el proyecto. 2. En el SQL Editor del proyecto de prueba, ejecutar `0032` (si no está) y luego `0033_notifications.sql`.
3. Verificación rápida: `select count(*) from notifications;` debe dar 0 y no dar error.

## Decisiones tomadas (revisables)
- Un aviso resuelto por estado **se reabre** si la situación vuelve (el diseño decía «no reaparecen»; se limitó a los descartados por el usuario). Evita que un fallo transitorio deje avisos cerrados para siempre.
- «Trial terminada sin pago» comparte el tipo `suspended_nonpayment` con motivo `trial_ended` (en vez de un tipo nuevo).
- Suspensión por el admin, cancelación con período vigente y prueba normal: sin aviso.

# Cierre — Etapa 6c: la fase de suscripción manda en el servidor y en la pantalla

## Reglas aplicadas (confirmadas por el usuario el 2026-10-20)
1. Prueba terminada sin pago: **sin gracia**. Puede entrar, pero solo ve «Suscripción» (pago). Igual que quien ya tenía pagos y no regularizó.
2. Suscripción activa cuyo cobro falló: sigue con acceso completo hasta `end_date`; luego **gracia** (hoy 5 días, configurable en /admin/configuracion) con acceso completo; pasada la gracia queda **bloqueado** (solo Suscripción).
3. La gracia solo existe si hubo al menos un pago `reconciled` de esa suscripción.
4. Administradores: nunca se bloquean.
5. Suspendida por el admin: también bloqueado (supuesto; ver «Pendiente»).

## Cambios
Nuevos:
- `lib/services/access.ts`: `getMyAccess()` (suscripción + rol + `app_settings` + pago previo → fase) y `requireFullAccess()`. Usa `plans!plan_id(...)` (evita la ambigüedad de las dos claves hacia `plans`). Si falla la lectura de la suscripción por un error técnico, **no bloquea** (queda marcado `degraded`).
- `lib/subscription-notice.ts` (+test): texto del aviso por fase (prueba por terminar, cobro fallido, gracia, bloqueado).
- `components/features/subscription/access-banner.tsx`.
- Tests: `lib/services/access.test.ts`, `lib/actions/accessGuard.test.ts`; 3 casos nuevos en `lib/subscription-phase.test.ts`.

Modificados:
- `app/page.tsx`: calcula el acceso; si está bloqueado **no carga** lista de precios, clientes ni oficios; en gracia muestra «Pago pendiente».
- `components/app-shell.tsx`: bloqueado → pantalla con solo cabecera, «Cerrar sesión», aviso y Suscripción/pago (sin menú). Con acceso: aviso arriba cuando corresponde.
- `lib/services/userTrades.ts`: `getMyTradeLimit` usa la fase (la gracia conserva el límite del plan).
- Acciones protegidas con `requireFullAccess()` (devuelven el mensaje «Tu suscripción no está al día…» y no tocan la base): agenda (todas), clientes, presupuestos (altas/cambios/bajas), ficha de cliente, precios personales, perfil.
- **No** protegidas a propósito: pagos, Mercado Pago, cerrar sesión (para poder regularizar).
- `agenda.test.ts` y `quotes.test.ts`: mock de `requireFullAccess`.

Sin migraciones nuevas. `hasAccess` (lib/subscription-access.ts) sigue existiendo: lo usan las pantallas de admin.

## Pruebas ejecutadas
`tsc --noEmit` sin errores · `vitest`: 29 archivos, 364 tests OK (1 omitido ya existente) · `next build` OK (variables ficticias).

## NO probado
- Nada contra Supabase real ni en el navegador.
- Los mensajes y el aspecto del aviso en los distintos temas (claro/oscuro).

## Límites conocidos (honestos)
- El bloqueo está en la página y en las acciones del servidor. **La base de datos (RLS) todavía deja leer/escribir los datos propios** a quien llame a la API directamente con su sesión. Cerrarlo del todo requiere una migración (etapa aparte).
- Lecturas sueltas (`fetchMyQuotes`, `fetchClientDetail`, etc.) no están protegidas; la pantalla ya no las ofrece.
- Las pantallas de admin siguen mostrando «Vencida» durante la gracia (usan la regla anterior).

## Prueba manual sugerida (SOLO proyecto/usuario de PRUEBA)
1. Usuario con prueba: en SQL Editor `update subscriptions set end_date = current_date - 1 where user_id = '<id>' and status = 'trial';` → recargar: pantalla restringida con «Tu prueba gratuita terminó».
2. Usuario `active` con un pago `reconciled`: `end_date = current_date - 2` → entra normal con aviso amarillo de gracia; `end_date = current_date - 8` → restringido.
3. Mismo usuario sin pagos `reconciled` y vencido ayer → restringido (sin gracia).
4. Restringido: no hay menú; intentar abrir `/?vista=suscripcion` muestra lo mismo; «Cerrar sesión» funciona; el pago por transferencia/Mercado Pago sigue disponible.
5. Admin con suscripción vencida: entra normal.
Si la base rechaza el `update` (triggers de protección de las migraciones 0025–0030), avisame y lo simulamos por otro camino.

## Pendiente / decisiones
- Suspendida por el admin: hoy ve la pantalla restringida con aviso «cuenta suspendida». ¿Debe poder pagar o solo contactar a soporte?
- Etapa 3 (recuperación de contraseña): sigue abierta (el enlace del correo vuelve a la Site URL).

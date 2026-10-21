# Cierre — Etapa 6a: función de fases de suscripción
Nuevos: `lib/subscription-phase.ts`, `lib/subscription-phase.test.ts`. No se modificó ningún archivo existente (`hasAccess` intacto; se integra en 6c).
Pruebas: `pnpm typecheck` sin errores; `pnpm test` 24 archivos / 320 tests OK (11 nuevos, incluida la equivalencia con `hasAccess` actual cuando gracia=0).
Sin base de datos, sin UI, sin migraciones, sin cambios de comportamiento para el usuario.
Supuestos aplicados (a confirmar): gracia con acceso completo; sin gracia tras fin de prueba ni cancelación voluntaria; gracia solo con pago confirmado previo.
Pendiente: 6b (tabla `app_settings` + panel), 6c (usar la fase en el servidor y la UI). El dato `hasPaidBefore` y `autoRenewal` deberán obtenerse de `payments` y `mp_preapprovals`.

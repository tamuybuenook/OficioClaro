# Informe — Diagnóstico Mercado Pago, «Sin plan» y migración 0034 (21/10/2026)

**Estado:** todo lo de abajo es **local en este ZIP**. No se desplegó nada en Vercel y **no se ejecutó nada en Supabase**. No se hicieron pagos ni se tocó ningún dato.

## 1. Causa encontrada
**«Sin plan» / «Acceso hasta —»** — `getMySubscription()` pedía `plans(*)` desde `subscriptions`, que tiene dos claves hacia `plans` (`plan_id` y `mp_plan_id`, confirmado con la consulta de claves). PostgREST responde «relación ambigua», y `app/page.tsx` convertía ese error en `null` sin registrarlo. `computeAccess` ya usaba `plans!plan_id`, por eso el cartel «Recibimos tu pago… 23/07/2027» (que sale de esa lectura) sí aparecía.
Aún **no probado contra el Supabase real**: la certeza viene del código y de que la consulta de claves coincide; la confirmación definitiva es ver la pantalla tras desplegar.

Había 4 lugares con el mismo defecto (el detector los encontró todos, y solo esos): `lib/services/subscriptions.ts`, `lib/services/payments.ts` (2 consultas) y `app/admin/suscripciones/page.tsx`. Las consultas desde `payments` hacia `plans` NO se tocaron: `payments` tiene una sola clave hacia `plans`.

**Pagos:** los 4 pagos `reconciled` (ids `184407168575`, `185441000442`, `184393434969`, `184392014873`) tienen `applied_at` y 4 auditorías `mp_approved` (23/01, 23/04, 23/07 y 23/10/2027). Son 4 pagos distintos de un plan trimestral: cada uno compra un período, no hay duplicado. No se modificó ni reprocesó nada. Una repetición no puede extender de nuevo: en `record_mp_payment` (0032) un pago ya `reconciled` con `applied_at` devuelve `duplicate` antes de tocar la suscripción (hay prueba SQL n.º 15 en `supabase/tests/03_mercadopago.sql`; **no se ejecutó aquí**).

## 2. Webhook
- Los cambios de diagnóstico **ya estaban en el ZIP** (`signature.ts`, `route.ts`, `route.test.ts`). Falta confirmar que el despliegue de Production los incluye.
- Se agregó al registro de rechazo solo `formato` («ipn» si llega `?id=…&topic=…` sin `data.id`, si no «webhook») y `topic` (solo si es una palabra corta). `merchant_order` queda así separado de `payment.created`. La verificación de firma **no se tocó**.
- `merchant_order` (orden `45481702722`): 401 esperado y sin efecto (formato IPN, sin firma; el código además lo ignoraría). Es un evento distinto del pago `184407168575`.
- `payment.created`: **causa del 401 sin confirmar.** Dato nuevo: `mp_webhook_events` no tiene filas en 3 días, coherente con que ninguna notificación pasó la firma (o con que el insert falló en silencio: `logEvent` no frena el flujo). Los 4 pagos se aplicaron por otra vía, no por el webhook (el último, 15 s después del `payment.created`: probablemente el sondeo al volver o «Ya pagué»; hipótesis, la auditoría no guarda la vía). No se cambió ninguna variable.

## 3. Migración 0034
`0034_fix_service_role_permissions.sql` concede a `service_role` solo SELECT/INSERT/UPDATE sobre 10 tablas que el código usa (lista y archivo de origen dentro del SQL). **No es el SQL original recibido**, que se archivó en `docs/propuestas/0034_service_role_amplio.propuesta.sql` (sin COMMIT, `GRANT ALL`, y `ALTER DEFAULT PRIVILEGES`). No se creó 0035. Es idempotente.
**Evidencia que no cierra:** hoy entre 20:27 y 23:22 UTC el servidor, con `service_role`, insertó y leyó `payments`; eso es incompatible con «no puede leer payments», salvo que algo cambiara después o la consulta midiera otra cosa. Conviene correr la verificación **antes** de aplicar 0034. Esa verificación es `supabase/diagnostics/0034_verify_service_role_grants.sql` (solo lectura, también sirve después).

## 4. Archivos
Modificados: `lib/services/subscriptions.ts`, `lib/services/payments.ts`, `app/admin/suscripciones/page.tsx`, `app/page.tsx` (registra el código de error en lugar de ocultarlo), `app/api/mercadopago/webhook/route.ts`, `app/api/mercadopago/webhook/route.test.ts` (+2 pruebas), `docs/CONTINUACION_OFICIOCLARO.md`.
Nuevos: `supabase/migrations/0034_fix_service_role_permissions.sql`, `supabase/diagnostics/0034_verify_service_role_grants.sql`, `lib/services/plan-embeds.test.ts`, `lib/services/subscriptions.test.ts`, `docs/propuestas/0034_service_role_amplio.propuesta.sql`, este informe.

## 5. Pruebas
**Ejecutadas de verdad:** (a) `plan-embeds.test.ts` con un reemplazo mínimo de vitest: **falla** sobre el código original (detecta las 4 consultas) y **pasa** sobre el corregido; (b) la ruta real del webhook con pedidos simulados: IPN, firma mala, tópico raro y firma válida, todo como se esperaba; (c) revisión de sintaxis TypeScript de los archivos tocados (0 errores de sintaxis).
**NO ejecutadas:** `pnpm test` completo y `pnpm typecheck` (sin dependencias ni red); las 2 pruebas nuevas de `route.test.ts` y `subscriptions.test.ts` bajo vitest real; toda prueba SQL y la migración (sin Postgres); nada contra Supabase, Vercel ni Mercado Pago reales. Las cifras «500 pruebas» no están verificadas.

## 6. Pendiente (en orden)
1. En tu máquina: `pnpm test` y `pnpm typecheck`; si algo falla, mandame el texto.
2. Subir a `main` y confirmar el despliegue; revisar «Mi suscripción» (plan y fecha 23/10/2027). No hay que pagar de nuevo.
3. Ejecutar la verificación de permisos; solo si alguna fila da `false`, aplicar 0034 (primero en un proyecto de prueba) y repetir la verificación.
4. Con el parche desplegado, leer en Vercel la línea `firma rechazada` del próximo `payment.created` (si no hay uno nuevo, reenviarlo desde el panel de Mercado Pago, sin pagar) para decidir si el problema es el secreto.

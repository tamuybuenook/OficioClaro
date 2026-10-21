# Informe — Cierre de Mercado Pago y panel administrativo

**Estado:** panel terminado y listo para una validación controlada. **No** está validado contra Mercado Pago real (no se hicieron pruebas Sandbox) y **no** se declara listo para producción. Sin migraciones nuevas, sin despliegues, sin cobros. 0022–0030 intactas (0022–0029 verificadas por hash).

## Archivos de esta etapa
Nuevos: `app/admin/facturacion/{page.tsx, pagos/[id]/page.tsx, clientes/[userId]/page.tsx, facturacion.pages.test.ts}`, `components/admin/billing/ui.tsx`, `lib/admin/billing/*` (classify, filters, format, queries, mp-settings, reconcile-status, user-email + pruebas), `lib/mercadopago/reconcile-log.ts`, `app/api/mercadopago/reconcile/route.test.ts`, `app/admin/configuracion/page.test.ts`, `vercel.json`, `supabase/tests/{04_admin_billing_panel.sql, run_admin_billing.sh}`, `docs/{FACTURACION_ADMIN, VERCEL_MERCADOPAGO, PROPUESTA_FACTURACION_FISCAL, INFORME_CIERRE_MP_ADMIN}.md`, `docs/propuestas/0031_comprobantes_fiscales.propuesta{.sql,.test.sql}` (**propuesta, no aplicada**).
Modificados: `app/admin/configuracion/page.tsx`, `app/api/mercadopago/reconcile/route.ts` (registra cada ejecución en `audit_logs`), `components/admin/admin-nav-config.ts` (menú), `vitest.config.ts` (JSX para pruebas de render), `.env.example`, `docs/MERCADOPAGO.md`.

## Validación ejecutada
| Prueba | Resultado |
|---|---|
| `tsc --noEmit` | sin errores |
| `next build` | OK (rutas nuevas generadas) |
| Vitest | 281/281 (22 archivos) |
| SQL Mercado Pago (`run_mercadopago.sh`) | 222/222 |
| SQL panel (`run_admin_billing.sh`: RLS, columnas, aislamiento, relaciones) | 21/21 |
| SQL aceptación | 94/94 |
| Concurrencia (transferencias, cobro retenido) | PASS |
| Propuesta 0031 en base local | 20/20 |
| SQL agenda (`run_agenda.sh`) | 17/18: falla la n.º 10 («updated_at se renueva»). Prueba de la agenda (0022), no modificada en esta etapa; no la investigué. |

Límites de lo probado: las pantallas se probaron con un cliente de Supabase simulado y la RLS/columnas contra PostgreSQL real, **no** a través de PostgREST real ni en un navegador.

## Hallazgo a verificar (no modificado)
`subscriptions` tiene **dos** relaciones con `plans` (`plan_id` y, desde 0023, `mp_plan_id`; la prueba SQL D5 lo confirma). Los embeds sin pista `plans(...)` desde `subscriptions` (`app/admin/suscripciones/page.tsx`, `lib/services/subscriptions.ts`, `lib/services/userTrades.ts`) pueden devolver «más de una relación» en PostgREST. No lo pude comprobar sin PostgREST real. Si `/admin/suscripciones` sale vacía o falla el límite de oficios, esa es la causa; el arreglo es `plans!subscriptions_plan_id_fkey(...)`. Mis consultas ya llevan la pista. No lo toqué por estar fuera del alcance (regla de acceso).

## 3. Variables y Vercel
Ver `docs/VERCEL_MERCADOPAGO.md` (tabla Preview/Production y pasos exactos).

## 4. Webhook
`https://<dominio>/api/mercadopago/webhook` — eventos **Pagos**, **Planes y suscripciones** (`subscription_preapproval`) y **Pagos recurrentes** (`subscription_authorized_payment`); modo prueba y producción por separado, cada uno con su clave.

## 5. Cron
Preparado en `vercel.json` (diario, `0 9 * * *` UTC; único válido en Hobby). **No verificado.** Para activarlo: definir `CRON_SECRET` en Production, desplegar, confirmar la ruta en Vercel → Settings → Cron Jobs, ejecutarla a mano con el Bearer y comprobar «Última ejecución correcta» en `/admin/configuracion`. Los cron corren solo en Production.

## 6. Pruebas Sandbox que faltan antes de habilitar producción
1. Pago único aprobado (`APRO`): una sola extensión de `end_date`, registro en el panel.
2. Rechazado (`OTHE`) y pendiente (`CONT`): sin cambios de suscripción.
3. Notificación duplicada: resultado `duplicate`.
4. Firma inválida: 401.
5. Renovación automática: alta, cobro, rechazo → `past_due`, cancelación.
6. Reemplazo de plan con autorización pendiente y fallo de cancelación → `cancelling` visible en el panel y reintento por cron.
7. Reembolso/contracargo de un pago aprobado: estado «Reembolsado», fuera de «cobrado».
8. Cobro con suscripción suspendida/cancelada: aparece como «Retenido».
9. Ejecución real del cron (punto 5).
10. Comprobar en la cuenta de MP que `payer_email` de renovación y los datos de prueba funcionan (pendiente heredado).
Además, antes de producción: una compra real mínima supervisada con reembolso y revisión fiscal con el contador.

## Pendiente fuera de alcance
Pantalla para resolver cobros retenidos; función SQL de agregación para volúmenes muy grandes; migración fiscal 0031 (requiere aprobación).

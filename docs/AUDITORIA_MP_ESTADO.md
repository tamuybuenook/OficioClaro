# Auditoría — Tarea 4: estado real de Mercado Pago y panel (solo lectura)

Fecha: 2026-10-19. No se modificó código ni base de datos en esta etapa.

## Lo que ya existe (reutilizar)
- **Estados** (`subscriptions.status`): `trial | active | past_due | suspended | cancelled`. Acceso por fecha: `lib/subscription-access.ts` (`hasAccess`: trial/active/past_due/cancelled mientras `end_date >= hoy`; `suspended` corta de inmediato).
- **Dos modalidades de cobro** ya implementadas (`startMpCheckout`): `one_time` (pago manual por período) y `recurring` (preapproval de MP). `cancelMpRenewal` cancela la renovación sin suspender.
- **Pagos**: `payments.status` = `pending | reconciled | rejected | refunded`; solo `reconciled` extiende `end_date`, una vez (`applied_at`).
- **Webhook** y **cron** (`/api/mercadopago/reconcile`, diario 09:00 UTC): idempotentes, con firma/CRON_SECRET y registro en `audit_logs`.
- **Prueba**: `plans.trial_days` editable por admin (`updatePlan`); trigger `handle_new_profile_trial` (0025) con antiabuso por email normalizado y `trial_pending` hasta verificar email.
- **Panel admin**: `/admin/facturacion` (pagos, clientes), `/admin/configuracion` (diagnóstico solo lectura).

## Brechas respecto de la política comercial
| Requisito | Estado real |
|---|---|
| Prueba 30 días | Existe (por plan, `trial_days`). Falta confirmar el valor cargado en la base real. |
| Aviso previo (5 días) | **No existe** (ni configuración ni envío). |
| Período de gracia (5 días) | **No existe.** Hoy `past_due` conserva acceso hasta `end_date` y luego se corta; no hay días extra. |
| Config. admin de aviso/gracia | **No existe**; no hay tabla de configuración global. |
| Envío de emails | **No hay proveedor ni cola.** Solo los correos de Supabase Auth. |
| Notificaciones en la app | **No existe** tabla ni UI. |
| Suspensión automática por falta de pago | **No existe**; el corte es implícito por fecha (`hasAccess`), sin cambio de estado ni aviso. |

## Riesgos conocidos (heredados del informe anterior, no reverificados)
1. Embeds `plans(...)` ambiguos desde `subscriptions` (dos FK a `plans`) pueden fallar en PostgREST real.
2. Prueba SQL de agenda n.º 10 («updated_at se renueva») fallaba.
3. Cron sin verificar en Vercel; Sandbox de MP sin ejecutar (10 pruebas pendientes, ver `INFORME_CIERRE_MP_ADMIN.md`).

## Pruebas de esta etapa
- Vitest local: 23 archivos / 309 tests OK (ejecutado hoy, tras el cambio de recuperación).
- Pruebas SQL (PostgreSQL): **no ejecutadas** (sin base local en este entorno). Los resultados SQL citados son del informe previo, no de hoy.

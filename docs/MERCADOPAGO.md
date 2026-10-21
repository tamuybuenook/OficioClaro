# Cobro de suscripciones con Mercado Pago

Alcance: **solo** el cobro de los planes de OficioClaro. No interviene en la facturación ni en los cobros de los profesionales a sus clientes.

## Circuito de pago

**Pago manual (Checkout Pro)**
1. Usuario elige plan en *Mi suscripción* → server action `startMpCheckout(planId, 'one_time')`.
2. El servidor lee el plan y el precio de la base (el cliente nunca envía montos), crea una fila `payments` (`provider='mercadopago'`, `pending`) y una preferencia en MP con `external_reference = payments.id`.
3. El usuario paga en Mercado Pago y vuelve a `/?vista=suscripcion&mp=...`. **La URL de retorno no activa nada**: la pantalla consulta el estado real (refresca cada 5 s hasta 1 min).
4. MP notifica a `POST /api/mercadopago/webhook`. Se valida la firma HMAC, se consulta `GET /v1/payments/{id}` con el token privado y se llama a `record_mp_payment` (SQL, atómica e idempotente): valida monto y moneda contra lo guardado, extiende `end_date` un período (desde el vencimiento vigente si todavía no pasó) y cambia al plan pagado.

**Renovación automática (Suscripciones / preapproval)**
1. `startMpCheckout(planId, 'recurring')` crea una preapproval con el monto congelado del plan (`external_reference = subscriptions.id`) y redirige al usuario a autorizarla.
2. Webhooks `subscription_preapproval` (estado de la autorización) y `subscription_authorized_payment` (cada cobro). Cada cobro se verifica contra la API y se registra igual que el pago manual. Cobro rechazado ⇒ `past_due` (conserva acceso hasta `end_date`).
3. `cancelMpRenewal()` cancela en MP; el acceso sigue hasta `end_date` (estado `cancelled`).

## Estados y acceso (regla única: `lib/subscription-access.ts`)
| Estado | Acceso |
|---|---|
| `trial`, `active` | hasta `end_date` |
| `past_due` (renovación fallida) | hasta `end_date` (período ya pagado) |
| `cancelled` (sin renovar) | hasta `end_date` |
| `suspended` (decisión de admin) | no |
| cualquiera con `end_date` vencido | no (se muestra "Vencida") |

Se aplica en el servidor en `getMyTradeLimit` (límite de oficios del plan). Agenda, presupuestos y clientes **no** se restringen por plan (no lo estaban antes y no se tocaron).

## Autorizaciones recurrentes (ledger)
Cada preapproval se registra en `mp_preapprovals` antes de crearse en MP (su `id` viaja como `external_reference`). Reemplazar = cancelar y confirmar la anterior, luego crear la nueva; si no se confirma, no se crea otra y queda registrada la incidencia (`audit_logs`, acciones `mp_incident_*`). `GET /api/mercadopago/reconcile` (con `CRON_SECRET`) reintenta cancelaciones y recupera creaciones a medias.

## Seguridad
- Token y secreto solo en variables de entorno del servidor; nunca se loguean (errores sin payloads ni cabeceras).
- Firma `x-signature` validada con `timingSafeEqual`; sin firma o sin configuración, el webhook no procesa nada.
- La notificación nunca es fuente de verdad: siempre se consulta la API.
- Idempotencia: `payments.external_id` único para MP + `pg_advisory_xact_lock` + `applied_at` (se extiende una sola vez). Notificaciones tardías o desordenadas no degradan un pago aprobado.
- `record_mp_payment` solo ejecutable con `service_role`.
- Migración 0023 corrige: usuarios podían insertar pagos con cualquier estado y crearse pruebas ilimitadas.
- `MP_ENV` se valida contra `VERCEL_ENV` para no mezclar credenciales de prueba y producción.

## Configuración
1. Aplicar `supabase/migrations/0023_mercadopago.sql` (primero en un proyecto de prueba).
2. Panel de MP → *Tus integraciones* → crear/abrir la app → **Credenciales de prueba** → copiar el Access Token a `MP_ACCESS_TOKEN`.
3. *Webhooks* → modo prueba → URL `https://<tu-dominio>/api/mercadopago/webhook` → eventos **Pagos**, **Planes y suscripciones** (`subscription_preapproval`, `subscription_authorized_payment`) → copiar la **clave secreta** a `MP_WEBHOOK_SECRET`.
4. Variables en Vercel (Preview: `MP_ENV=test`; Production: `MP_ENV=production`) — ver `.env.example`. `APP_URL` debe ser https para `auto_return`.

## Probar con credenciales de prueba
1. Crear dos usuarios de prueba en MP (vendedor y comprador) desde el panel. Pagar siempre con el **comprador** de prueba y tarjetas de prueba de MP (docs: *Tarjetas de prueba*). El titular decide el resultado: `APRO` aprobado, `CONT` pendiente, `OTHE` rechazado.
2. Pago manual: elegir plan → *Pagar* → completar con tarjeta de prueba → volver. Esperar la confirmación: `end_date` +1 mes. Revisar la tabla `mp_webhook_events`.
3. Rechazado/pendiente: repetir con `OTHE` / `CONT`; no debe cambiar la suscripción.
4. Duplicado: reenviar la misma notificación desde el panel de MP (*Webhooks → simular/reenviar*): outcome `duplicate`, sin segunda extensión.
5. Renovación automática: elegir *Renovación automática* y autorizar con el comprador de prueba (el `payer_email` debe corresponder a ese usuario de prueba; **verificar este punto en tu cuenta**, ver pendientes). Cancelar desde la pantalla y comprobar estado `Sin renovación`.
6. Firma inválida: `curl -X POST '<url>/api/mercadopago/webhook?data.id=1&type=payment'` ⇒ 401.

## Antes de producción
- Credenciales y clave secreta de producción en Vercel Production; `MP_ENV=production`; webhook en modo producción.
- Cuenta de MP con la cuenta habilitada para cobrar y Suscripciones activo.
- Una compra real de monto mínimo propia y reembolso, supervisada.
- Revisar con un contador el tratamiento fiscal de lo que OficioClaro cobra.

## Revisión de seguridad
Ver `docs/SEGURIDAD_MP_REVISION.md`. Migraciones a aplicar, en orden: 0023, 0024, 0025 (ledger de preapprovals, conciliación atómica, prueba verificada, permisos) y 0026 (suspensión/cancelación/eliminación con seguimiento, cobros retenidos). Propuesta de cambio de plan: `docs/PROPUESTA_CAMBIO_DE_PLAN.md`.

## Pruebas
- `pnpm test` (unitarias + webhook), `pnpm typecheck`, `pnpm build`.
- SQL: `bash supabase/tests/run_mercadopago.sh` (requiere el Postgres local de `run_baseline.sh`).

## Administración (panel, configuración, cron)
Ver `docs/FACTURACION_ADMIN.md`, `docs/VERCEL_MERCADOPAGO.md` e `docs/INFORME_CIERRE_MP_ADMIN.md`.

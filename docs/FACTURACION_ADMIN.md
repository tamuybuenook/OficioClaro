# Panel de facturación (`/admin/facturacion`)

Solo lectura. Acceso: `requireAdmin()` en el layout **y** en cada página; las consultas usan el cliente de la sesión del admin (RLS `is_admin()`), nunca `service_role`. Única excepción: el email del usuario (vive en `auth.users`) se lee con la API de administración, solo en los detalles y después de verificar admin.

## Definiciones (una sola fuente: `lib/admin/billing/classify.ts`)
| Categoría | Condición |
|---|---|
| Cobrado | `status='reconciled'` y (transferencia **o** pago de MP con `applied_at`) |
| Retenido | MP aprobado, sin aplicar, con `review_reason` y sin resolución |
| Reembolso pendiente | `review_resolution='refund_pending'` |
| Reembolsado | `status='refunded'` o `review_resolution='refunded'` |
| Sin aplicar | MP aprobado, sin aplicar y sin motivo de retención (anomalía) |
| Pendiente / Rechazado | según `status` |

Los intentos de cobro sin `external_id` se cuentan como pendientes pero se informan aparte y **nunca** como ingreso. Los reembolsos no se restan: simplemente no integran «cobrado». Sumas en centavos enteros. El período filtra por `payments.created_at` en hora argentina.

Los filtros del listado y el resumen usan la misma definición: hay una prueba de paridad contra PostgreSQL real (`classify.sql.test.ts`).

## Datos
- **Período cubierto**: se lee de `audit_logs` del propio pago (`end_date` de `mp_approved`, `reconcile` o `held_payment_apply`); no se recalcula. Pagos sin ese registro muestran «—».
- **Rendimiento**: listados paginados de 25 en el servidor (`range`). Los totales se agregan leyendo solo 7 columnas en trozos de 1.000 filas, con tope de 20.000 por período (si se supera, el panel avisa que el total es parcial). Una función SQL de agregación sería más eficiente a gran escala; no se creó para no tocar la base sin aprobación.
- **Búsqueda**: nombre del usuario, id de pago/suscripción/usuario, id de Mercado Pago, referencia y período `AAAA-MM`. No busca por email (no está en `profiles`).
- **Eventos**: `mp_webhook_events` con filtro por resultado y enlace al pago.
- **Alertas**: retenidos, reembolsos pendientes, aprobados sin aplicar, intentos inciertos, pendientes en MP > 48 h, eventos con error (7 d), incidencias `mp_incident_*` (30 d) y autorizaciones en `cancelling`.

## Fuera de alcance de esta etapa
- No hay botones para aplicar/reembolsar cobros retenidos ni cambiar estados: la operación existe en la base (`resolve_held_mp_payment`) pero su pantalla no se incluyó.
- No hay emisión de facturas (ver `PROPUESTA_FACTURACION_FISCAL.md`).

## Pruebas
`pnpm test` (Vitest, incluye render de pantallas y paridad SQL) y `bash supabase/tests/run_admin_billing.sh` (RLS y columnas contra el esquema real hasta 0030).

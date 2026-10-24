# Etapa 1 — Aprobación manual de transferencias

Estado: implementado y probado **en local**. No se tocó producción, no hay migraciones nuevas.
Mercado Pago: sin cambios. Rediseño general del panel: no iniciado (queda para la próxima etapa).

## 1. Diagnóstico (antes de cambiar nada)

**Causa concreta del bloqueo:** no existe ninguna pantalla ni botón que llame a la conciliación. El backend está completo, pero la interfaz no lo usa.

| Pieza | Estado real |
|---|---|
| Tabla y estados | `payments` (0001/0023): `provider` ∈ `transfer`/`mercadopago`; `status` ∈ `pending`/`reconciled`/`rejected`/`refunded`; guarda `reference`, `proof_url`, `amount`, `subscription_id`. Historial en `bank_reconciliations` (0001) y `audit_logs`. |
| El usuario informa la transferencia | `reportTransferPayment` (`lib/actions/payments.ts`), invocada desde `components/app-shell.tsx`. Inserta con RLS `payments_own_insert` (solo `transfer` + `pending`, solo en su propia suscripción) con límite de frecuencia. |
| Registrar/aprobar/rechazar | Función SQL `reconcile_transfer_payment(p_payment_id, p_status, p_notes)` — versión vigente en **0032** (antes 0025/0028). Una sola transacción: bloquea suscripción y pago, exige `is_admin()`, solo `transfer`, solo `pending`, actualiza pago, inserta `bank_reconciliations`, extiende/activa la suscripción según el período del plan y escribe `audit_logs`. |
| Activación/extensión | Dentro de esa misma función: `status='active'`, `end_date = max(end_date, hoy AR) + período del plan`. |
| Acción del servidor | `reconcilePayment` (existía) verifica admin con `getAdminContext` y llama al RPC. **Ningún archivo de `app/` ni `components/` la invocaba.** |
| Pantalla administrativa | `/admin/facturacion` y `/admin/facturacion/pagos/[id]` existen pero son de **solo lectura por diseño** (el detalle decía: "Vista de lectura… no esta pantalla"; `docs/FACTURACION_ADMIN.md`: "Solo lectura"). No hay ruta de conciliación; la acción revalidaba `/admin/conciliacion`, que no existe. |
| Permisos/RLS | `payments`: lectura dueño o admin; update solo admin; `bank_reconciliations`: solo admin; `audit_logs`: lectura admin, escritura solo por funciones. |

Archivos involucrados: `lib/actions/payments.ts`, `app/admin/facturacion/pagos/[id]/page.tsx`, `supabase/migrations/0032_plan_periods_3_6_months.sql`.

**Estado actual del pago pendiente en producción: NO lo pude verificar** (no tengo acceso a tu base). Corré las consultas de la sección 4 antes de desplegar.

**Cambio mínimo necesario:** interfaz + endurecer la acción. **No hace falta migración** (el circuito SQL ya cumple: admin verificado, estado único, transacción, auditoría).

**Riesgos:** (a) la aprobación extiende la suscripción: es irreversible desde la pantalla (por eso exige confirmar el ingreso del dinero); (b) si producción no tuviera aplicadas 0025–0032, la función podría diferir (ver verificación 4.2); (c) la base no exige motivo al rechazar (se exige en la acción/interfaz; un admin llamando al RPC directo podría omitirlo).

## 2. Qué se implementó
- `lib/actions/payments.ts` → `reconcilePayment({ paymentId, decision, notes, confirmFundsReceived })`: valida UUID y decisión; **aprobar exige `confirmFundsReceived === true`**; **rechazar exige motivo ≥ 5 caracteres**; verifica admin; una sola llamada al RPC transaccional; devuelve el nuevo vencimiento; revalida pantallas reales (`/admin/facturacion`, el detalle y `/`). Un fallo no revalida nada.
- `components/admin/billing/transfer-decision.tsx` (nuevo) en el detalle del pago, solo si es transferencia `pending`: muestra usuario, importe, referencia y comprobante; "Aprobar…" pide tildar "Confirmo que ingresaron $X de <usuario>"; "Rechazar…" pide motivo; protección contra doble clic; errores del servidor visibles ("Ese pago ya fue resuelto"); resultado con vigencia.
- El detalle ya no se presenta como solo lectura para pendientes; el historial distingue "rechazada" de "conciliada" (antes mostraba "conciliada" siempre).
- Listado/filtros: ya existían (`/admin/facturacion` filtra por estado Pendiente/Cobrado/Rechazado y por medio Transferencia). Historial: `bank_reconciliations` + `audit_logs` (quién, cuándo, nota) ya se grababan.

## 3. Pruebas (locales)
- Vitest completo: **57 archivos, 765 pruebas, todas pasan** (+9 de interfaz del panel, +8 de la acción). `tsc` sin errores. `next build` compila.
- SQL contra PostgreSQL 16 real, suite nueva `supabase/tests/run_transfer.sh`: **28/28** + concurrencia real (8 sesiones aprobando el mismo pago: 1 éxito, 7 "ya fue resuelto", 1 conciliación, 1 sola extensión). Mapa de los 8 escenarios pedidos: V1 pendiente visible · V2 aprobación y activación · V3 doble clic/reintento · V4 rechazo con motivo · V5 usuario común no puede (RPC, UPDATE directo, insertar como conciliado, anon) · V6 resuelto no se reaprueba · V7 aislamiento entre usuarios · V8 rollback total ante fallo.
- Prueba de mutación: quitando la verificación de estado `pending` de la función, 7 pruebas fallan (la suite detecta la regresión).
- Suites previas sin regresión: Mercado Pago 222/222, plan_periods 19/19.
- **Producción: no verificada.** No se probó con un Supabase real ni en un navegador; la interfaz se probó con jsdom.

## 4. Despliegue y verificación
Sin migraciones. Solo desplegar código.

**4.1 Antes (solo lectura, SQL Editor de producción)** — estado del pago:
```sql
select p.id, p.created_at, p.status, p.amount, p.reference, p.proof_url,
       s.id as sub_id, s.status as sub_status, s.end_date, pl.name as plan, pl.billing_period, pr.full_name
from payments p
join subscriptions s on s.id = p.subscription_id
left join plans pl on pl.id = s.plan_id
left join profiles pr on pr.id = s.user_id
where p.provider = 'transfer' and p.status = 'pending'
order by p.created_at;
```
**4.2 Antes — la función vigente y tu rol de administrador:**
```sql
select pg_get_functiondef('public.reconcile_transfer_payment(uuid,text,text)'::regprocedure) like '%plan_period_months%' as funcion_0032_aplicada;
select id, role from profiles where role = 'admin';   -- tu usuario debe figurar
```
Si `funcion_0032_aplicada` da `false` o la función no existe, **detenerse**: producción está desactualizada respecto de las migraciones y hay que revisarlo antes (otra causa posible del bloqueo).

**4.3 Desplegar** (Vercel preview primero) y entrar con el admin a `/admin/facturacion` → filtrar Estado "Pendiente" y Medio "Transferencia" → abrir el pago.

**4.4 Decidir:** comprobar en el banco que el dinero ingresó → "Aprobar…" → tildar → "Confirmar aprobación". Debe mostrar "Transferencia aprobada" con el vencimiento.

**4.5 Después (solo lectura):**
```sql
select p.status, s.status, s.end_date from payments p join subscriptions s on s.id = p.subscription_id where p.id = '<ID_DEL_PAGO>';
select status, notes, reconciled_by, created_at from bank_reconciliations where payment_id = '<ID_DEL_PAGO>';
select action, actor_id, new_value, created_at from audit_logs where entity_id = '<ID_DEL_PAGO>';
```
Esperado: pago `reconciled`, suscripción `active` con nuevo `end_date`, una fila de conciliación y una de auditoría. Verificar con el usuario que ve su suscripción activa.

**Reversión:** volver al despliegue anterior (no hay cambios de base). Una aprobación ya hecha no se revierte por código: requeriría corrección manual revisada.

## 5. Pendiente (no se hizo)
- La base no exige motivo al rechazar (queda en la acción/interfaz).
- El historial del detalle muestra "administrador" sin nombre (el id sí está en `audit_logs.actor_id`/`bank_reconciliations.reconciled_by`).
- No hay aviso al usuario por email/notificación al aprobar o rechazar.
- Mejoras del panel de usuario y del acceso administrativo: etapa siguiente.
- La prueba de interfaz requiere devDependencies `jsdom` y `@testing-library/*` (agregadas en la tarea anterior; si desplegás esta etapa sola, instalalas o excluí ese archivo de pruebas).

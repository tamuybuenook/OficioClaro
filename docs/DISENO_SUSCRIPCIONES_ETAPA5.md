# Etapa 5 — Diseño: máquina de estados, configuración y notificaciones
Solo diseño. Sin código ni migraciones. Supuestos marcados con **[SUPUESTO]** hasta que el usuario los confirme.

## 1. Principio: no tocar lo que funciona
- **No se agregan estados** al CHECK de `subscriptions.status` (migraciones 0001/0023/0025 ya aplicadas). Se agrega una **fase calculada** a partir de `status + end_date + configuración + pagos`.
- Una sola función pura `getSubscriptionPhase(sub, settings, today, hasPaidBefore)` reemplaza la lógica dispersa; `hasAccess` la usa. El servidor decide el acceso; nada local autoriza.

## 2. Fases (calculadas)
| Fase | Condición | Acceso | Aviso |
|---|---|---|---|
| `trial` | status=trial, hoy ≤ end_date − aviso | Sí | — |
| `trial_ending` | status=trial, end_date − hoy ≤ `notice_days` | Sí | Fecha y condiciones del cobro |
| `active_auto` | active + autorización MP vigente | Sí | Próximo cobro (aviso previo) |
| `active_manual` | active sin autorización | Sí | Vence el X; pagar para seguir |
| `renewal_off` | autorización cancelada por el usuario, período pagado vigente | Sí | Falta autorización de renovación |
| `payment_failed` | past_due, hoy ≤ end_date | Sí | Pago rechazado/fallido |
| `grace` | past_due o vencida con pago previo, end_date < hoy ≤ end_date + `grace_days` | **Sí [SUPUESTO: completo]** | Período de gracia + fecha de corte |
| `lapsed` | pasada la gracia, o fin de prueba sin pago | **No** (datos intactos) | Suspensión por falta de pago |
| `suspended_admin` | status=suspended | No, inmediato | — |
| `cancelled_end` | cancelled, hoy ≤ end_date | Sí | Fecha de fin |
- Cancelar renovación (`renewal_off`) ≠ falta de pago (`lapsed`): causas, textos y correos distintos.
- Pago pendiente/rechazado nunca confirma: solo `payments.status='reconciled'` extiende (ya implementado).
- **Riesgo detectado:** el trigger 0025 crea suscripciones `past_due` con `end_date = ayer` para quien no obtuvo prueba. Esos usuarios **no deben recibir gracia**. Regla: gracia solo si existe al menos un pago `reconciled` de esa suscripción. **[SUPUESTO]** Tampoco hay gracia al terminar la prueba sin pago (ya tuvo aviso previo).

## 3. Configuración administrable
- Tabla nueva `app_settings(key text pk, value jsonb, updated_by, updated_at)`; RLS: lectura/escritura solo admin; el servidor lee con service role.
- Claves: `notice_days`=5 (rango 1–15), `grace_days`=5 (rango 0–30). La **duración de la prueba sigue en `plans.trial_days`** (ya editable; no duplicar).
- UI: sección «Política de suscripción» en `/admin/configuracion`, con validación en servidor y registro en `audit_logs`.
- Numeración: `0031_comprobantes_fiscales.propuesta` está sin aplicar; la migración de esta etapa usaría 0031 y la fiscal pasaría a 0032 si se aprueba.

## 4. Notificaciones (reutilizable)
Tabla `notifications`: `id, user_id, kind, source ('subscription'|'payment'|…), dedupe_key UNIQUE, due_date, status ('open'|'dismissed'|'resolved'), action jsonb {label,url}, payload jsonb, created_at, resolved_at, email_status ('none'|'pending'|'sent'|'failed'), email_attempts, email_sent_at, email_last_error`.
- `dedupe_key = kind:subscription_id:fecha_de_referencia` → una sola fila por hecho, aunque cron o webhook corran dos veces.
- `kind` iniciales (los 8 pedidos): `trial_ending`, `auto_charge_upcoming`, `renewal_not_authorized`, `payment_failed`, `manual_due_soon`, `grace_period`, `suspended_nonpayment`, `payment_confirmed`.
- **Resolución por estado real:** `syncNotifications(userId)` idempotente: crea las que correspondan a la fase actual y marca `resolved` las que ya no aplican (p. ej. pago confirmado cierra `payment_failed`/`grace`/`suspended`). No reaparecen: la clave única lo impide. Solo las informativas se pueden descartar.
- UI: un banner en el inicio con la de mayor prioridad (suspensión > gracia > pago fallido > aviso > informativas). Futuras funciones (agenda, presupuestos) agregan `kind` nuevos sin cambiar el esquema. **No se implementan ahora.**
- Ahorro: los avisos de la app se calculan al cargar el inicio (1 consulta indexada); no dependen del cron.

## 5. Emails y cron (etapa 8)
- Sin proveedor hoy. **Decisión pendiente (una):** proveedor de email transaccional. Candidato: Resend (plan gratuito, límite diario bajo; alcanza para el volumen inicial). Alternativa: SMTP propio en Supabase solo para Auth, no sirve para estos envíos.
- Se reutiliza el cron diario existente, **sin segundo cron**: tras `reconcileIntents/recoverPreapprovals` → `syncNotifications` de usuarios con fechas relevantes → envío de hasta N emails `pending`.
- Envío seguro: marcar intento antes de enviar, máximo 3 intentos, error registrado sin datos sensibles, nunca reenviar si `email_status='sent'`.
- Demora: los correos pueden salir hasta ~24 h después del hecho (cron diario); el webhook de pagos sigue actualizando en el momento. Documentar en el panel.
- Suspensión: `hasAccess` ya corta por fecha; el cron solo crea el aviso y el correo (no hace falta cambiar `status`).

## 6. Plan de implementación (cada una cierra con ZIP)
| Etapa | Contenido | Esfuerzo | Riesgo | Criterio de aceptación |
|---|---|---|---|---|
| 6a | `getSubscriptionPhase` + tests (sin UI, sin base) | S | Bajo | Tabla de fases cubierta, incluido «past_due sin pago previo ⇒ sin gracia» |
| 6b | Migración `app_settings` + sección admin | M | Medio | Admin cambia valores; rangos validados; auditado |
| 6c | `hasAccess` con gracia en servidor y UI | S | Medio | Acceso coherente en todas las pantallas que lo usan |
| 7 | Tabla `notifications` + sync + banner | L | Medio | Sin duplicados al repetir sync; se resuelven al pagar |
| 8 | Emails + integración en el cron | M | Alto | Idempotente; sin reenvíos; errores registrados |
| 9 | Pruebas Sandbox integrales | M | Medio | Las 10 pruebas del informe previo + flujos nuevos |

## 7. Decisiones pendientes del usuario
1. Gracia con acceso completo (propuesto) o limitado.
2. Sin gracia al terminar la prueba sin pago (propuesto).
3. Proveedor de email (necesario recién en la etapa 8).

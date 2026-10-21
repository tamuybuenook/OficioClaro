# Revisión de seguridad — Mercado Pago (OficioClaro)

**Estado: NO lista para producción.** Falta ejecutar las pruebas de extremo a extremo con Mercado Pago de prueba y un Supabase aislado (sección 5). Migraciones: **0023, 0024 y 0025**, aplicadas solo en PostgreSQL local de prueba; nada se aplicó en Supabase remoto. La migración 0022 (agenda) no se tocó (verificada byte a byte contra el ZIP original).

## 1. Cambios de esta ronda

| Tema | Qué se hizo | Dónde |
|---|---|---|
| Autorizaciones recurrentes duplicadas | Ledger `mp_preapprovals`: cada preapproval queda registrada **antes** de existir en MP (su id es el `external_reference`), con estado, intentos y último error; índice único: una sola abierta por suscripción. Para reemplazar, la anterior se **cancela y se confirma** (respuesta de MP o `GET`) antes de crear otra; si no se confirma: no se crea otra, queda `cancelling`, se registra incidencia (`audit_logs`) y se informa el error. Las columnas `subscriptions.mp_*` pasan a ser un espejo mantenido por trigger. Recuperación: creaciones a medias se resuelven buscando por `external_reference`; cancelaciones sin confirmar se reintentan (cron/solicitud siguiente). Notificaciones tardías de autorizaciones reemplazadas: incidencia + nueva cancelación; un cobro real de una autorización cerrada **se acredita** y queda auditado | `0025` (A, B), `lib/mercadopago/{preapprovals,checkout,process-event,store}.ts` |
| Conciliación de transferencias | `reconcile_transfer_payment` (SQL, una transacción): admin verificado en la base, solo `transfer` + `pending`, bloqueo de fila, estado + extensión + registro de conciliación + auditoría juntos. `reconcilePayment` ahora solo llama al RPC | `0025` (C), `lib/actions/payments.ts` |
| Prueba gratuita | Solo con email **válido y verificado**. Email nulo/inválido: nunca hay prueba. Email válido sin verificar: suscripción vencida con `trial_pending`; al verificarse el email (trigger sobre `auth.users`) se concede la prueba si esa persona no la usó. Los reclamos (`trial_claims`) no tienen FK: borrar la cuenta no libera la prueba. Zona horaria corregida (ver 2) | `0025` (D) |
| Cambio de plan | `confirmTrades` ya no se bloquea tras la primera confirmación: recibe la selección completa, **no permite quitar** lo confirmado, agrega solo los nuevos hasta el límite vigente; la base lo exige también (trigger). Bajar de plan conserva todo y solo impide altas | `lib/actions/userTrades.ts`, `mis-oficios.tsx`, `0024` trigger |
| Funciones privilegiadas | Ver sección 3 | `0025` (E) |

**Por qué se bloqueaba la modificación:** `confirmTrades` rechazaba cualquier llamada si ya había filas en `user_trades` (`current.length > 0 ⇒ LOCKED`), y `enableTrade/disableTrade` están deshabilitadas por diseño ("doble confirmación"). No existía ninguna regla en la base. Cambio mínimo: mantener la confirmación y la imposibilidad de quitar, pero permitir **ampliar**.

## 2. Hallazgo adicional corregido: zona horaria (alto)
Las funciones usaban `current_date` (zona del servidor, UTC) mientras la regla de acceso usa la fecha de Argentina. Entre las 21:00 y las 24:00 AR, una suscripción "vencida ayer" (UTC) seguía con acceso. Se agregó `ar_today()` y se usa en las funciones nuevas; `createLapsedSubscription` ahora usa fecha AR menos 2 días. *Pendiente de revisar fuera de esta ronda:* `0016`/`0024` anteriores usan `current_date` en la creación de la prueba (efecto: la prueba empieza/termina hasta 3 h "corrida"), `0025` ya redefine esa función.

## 3. Funciones privilegiadas (0023–0025)
`SECURITY DEFINER` ahora con `set search_path = ''` y objetos calificados (`public.`, `auth.`). `EXECUTE` retirado a `public`, `anon` y `authenticated` (Supabase concede a anon/authenticated por defecto, por eso se revoca explícitamente):

| Función | Quién puede ejecutarla | Nota |
|---|---|---|
| `record_mp_payment(…, text)` | `service_role` | firma anterior de 7 parámetros eliminada |
| `rate_limit_hit` | `service_role` | |
| `reconcile_transfer_payment` | `authenticated` | verifica `is_admin()` adentro (anon: no) |
| `user_trade_limit`, `subscription_has_access`, `normalize_email`, `ar_today` | nadie directo (uso interno) | antes `user_trade_limit(uuid)` permitía consultar el plan de cualquier usuario |
| `enforce_user_trades_limit`, `handle_new_profile_trial`, `grant_trial_on_email_confirmed`, `sync_mp_mirror` | nadie directo (triggers) | |

Los triggers y las llamadas desde `service_role` siguen funcionando (probado). **Fuera de alcance de esta ronda y con `search_path = public`:** `is_admin`, `handle_new_user`, `apply_ipc_update`, `apply_my_ipc_update`, `set_ut_value`, `set_master_ut_value` (migraciones 0003–0021, algunas ya aplicadas). Recomendación: revisarlas en una migración aparte (`is_admin` está en todas las políticas RLS; cambiarla exige prueba cuidadosa).

## 4. Pruebas

### Ejecutadas y aprobadas
- `pnpm typecheck` OK · `pnpm build` OK (rutas `/api/mercadopago/webhook` y `/reconcile` generadas).
- `pnpm test` (Vitest): **151/151** en 12 archivos. Incluye: cancelación exitosa, PUT sin estado cancelado, rechazo (400), timeout con y sin confirmación por `GET`, reintento, 404; reemplazo (orden cancelar→crear), reemplazo bloqueado si no se confirma, alta simultánea, timeout al crear con recuperación por `external_reference`, falla de base tras crear en MP; notificaciones tardías/repetidas/adelantadas; `reconcilePayment` (autorización, delegación al RPC, errores); `confirmTrades` (ampliar Básico→Medium sin duplicar, no quitar, límite, bajar de plan, vencida).
- SQL (Postgres 16 local, `run_mercadopago.sh`): **82/82**. Cubre: ledger (índice único, espejo, cancelación), cobros de autorización reemplazada, conciliación (no admin, doble ejecución, MP, estado inválido, **rollback ante fallo**), prueba (email nulo/inválido/sin verificar/verificado, alias de Gmail, cuenta recreada, claves sobrevivientes), `search_path` hostil, matriz de `EXECUTE`.
- Concurrencia real (`run_concurrency.sh`, dos sesiones): la 2.ª espera el bloqueo (≈1,6 s), recibe "ya fue resuelto"; **un solo registro y una sola extensión**.
- SQL de aceptación previa: **94/94** (con 0023–0025 aplicadas).
- Visual (Chromium, datos simulados, 390 px): «Mi suscripción» (ronda anterior, 9 estados) y «Mis oficios» (cuatro casos: ampliar, cupo completo, vencida, primera selección).

### Ejecutadas y fallidas
- Suite SQL de agenda (`02_agenda.sql`): **17/18**. Falla `10 updated_at se renueva al modificar`. **Es previa y ajena a esta integración**: la suite aplica solo hasta 0021 + 0022, no incluye 0023–0025, y el caso compara `updated_at` dentro de una misma transacción (`now()` no cambia). 0022 no se modificó.

### Pendientes (requieren entorno real)
Todo lo que habla con Mercado Pago o Supabase reales, entre otros:
- Que `GET /preapproval/search?external_reference=…` funcione como se asume (se usa para recuperar creaciones a medias; **supuesto no verificado**).
- Que el `PUT status=cancelled` de una preapproval `pending` responda `cancelled` como se asume, y los tiempos reales de reintento del webhook.
- Comportamiento de `payer_email` (¿debe coincidir con la cuenta de MP?).
- Que Supabase Auth dispare el UPDATE de `email_confirmed_at` que activa `grant_trial_on_email_confirmed` (flujo "Confirm email" activado) y el alta con Google (confirmado al insertar).
- Trigger sobre `auth.users` en el proyecto Supabase real (permisos del rol que aplica migraciones).
- Revisión visual manual en un celular real.

## 5. Procedimiento E2E (Mercado Pago de prueba + Supabase aislado)
1. **Supabase aislado**: proyecto nuevo, distinto de producción. Aplicar 0001–0025 en orden (`supabase db push` apuntando solo a ese proyecto). Auth → activar **Confirm email**; opcional CAPTCHA.
2. **Vercel Preview**: `MP_ENV=test`, token y clave secreta de **prueba**, `APP_URL` https del preview, claves del Supabase aislado, `CRON_SECRET`.
3. **MP**: usuarios de prueba vendedor/comprador; Webhooks modo prueba → `<APP_URL>/api/mercadopago/webhook` (Pagos + Planes y suscripciones).
4. **Casos de prueba** (tarjetas de prueba; `APRO`/`CONT`/`OTHE`):
   - Prueba: alta con email sin verificar ⇒ sin acceso; confirmar ⇒ 30 días; segunda cuenta `x.y+2@gmail.com` ⇒ sin prueba; alta con email falso ⇒ sin prueba.
   - Pago manual aprobado / pendiente / rechazado / duplicado / firma inválida.
   - **Renovación automática**: alta; cobro; rechazo ⇒ `past_due`; cancelar ⇒ acceso hasta `end_date`; **reemplazo de plan con autorización pendiente** (la anterior debe verse `cancelled` en el panel de MP y en `mp_preapprovals`); simular fallo de cancelación (revocar el token un momento) ⇒ error al usuario, fila `cancelling`, incidencia en `audit_logs`; luego `GET /api/mercadopago/reconcile` con `Authorization: Bearer $CRON_SECRET` ⇒ se completa.
   - Autorizar en MP una preapproval ya reemplazada (abrir un enlace viejo) ⇒ incidencia y nueva cancelación.
   - Conciliación de transferencias desde SQL/RPC con un admin real; doble clic.
   - Subir Básico→Medium: agregar oficios hasta 3; intentar un 4.º (UI, Server Action y `insert` directo con la clave pública: los tres deben fallar). Bajar a Básico: datos visibles, sin altas.
   - 7 checkouts seguidos ⇒ el 7.º se bloquea. Reembolso ⇒ auditado, acceso intacto.
   - Caída de base durante un pago ⇒ reintento del webhook o "Ya pagué".
5. Revisar `mp_webhook_events` y `audit_logs` (acciones `mp_incident_*`) tras cada caso.

## 6. Riesgos residuales
- **Prueba gratuita**: la normalización de email **no es prueba de identidad**. Direcciones descartables o dominios propios siguen permitiendo nuevas pruebas (alias en dominios no-Gmail con `.` distintos no se normalizan). Mitigaciones fuera de alcance sin decisión de producto: CAPTCHA, lista de dominios descartables, verificación por CUIT/teléfono.
- Un proyecto Supabase con "Confirm email" **desactivado** marca todos los emails como confirmados al alta: el control de verificación no aporta nada ahí.
- Ventana entre la cancelación en MP y su confirmación en la base: si el proceso muere entre ambas, la fila queda `cancelling` y se reintenta (cron). Sin cron configurado, se reintenta solo en la siguiente solicitud del usuario o del webhook.
- Cobros recurrentes perdidos: dependen de los reintentos del webhook de MP (la conciliación activa cubre pagos manuales, no recurrentes).
- Política de pago de un plan distinto con tiempo abonado: **sin cambios**, ver `docs/PROPUESTA_CAMBIO_DE_PLAN.md`.
- Funciones de 0003–0021 con `search_path = public` (sección 3).
- `audit_logs` permite insertar a cualquier usuario autenticado (previo).
- Límite de frecuencia de login/registro: configurarlo en Supabase Auth.

## 7. Condiciones antes de pensar en producción
Aplicar 0023–0025 primero en el Supabase aislado y completar todo lo de la sección 5; verificar los supuestos de la sección 4 "pendientes"; decidir la política de cambio de plan; configurar Auth (confirmación de email, CAPTCHA); credenciales de producción solo en Vercel Production con `MP_ENV=production`; backup y autorización explícita para migrar producción; compra real mínima supervisada con su reembolso.

---

# Etapa 1 (cierre de integración): suspensión, cancelación y eliminación con renovaciones activas

Migración nueva **0026** (solo local; no aplicada en remoto). `0023`–`0025` y `0022` no se modificaron.

## Comportamiento
| Operación | Qué pasa |
|---|---|
| Suspender / cancelar (admin) | `mp_begin_wind_down` (una transacción, bloqueo de fila): aplica el estado y pasa **todas** las autorizaciones abiertas (incluida una creación en curso) a `cancelling`, con auditoría. Luego se cancela en MP y **se confirma** (respuesta o `GET`). Si no se confirma (rechazo, timeout, incierto, MP sin configurar): el estado local queda aplicado, la fila sigue `cancelling` + incidente, y se reintenta (cron o siguiente intento). Se avisa al admin. **Nunca** se marca `cancelled` sin confirmación. |
| Eliminar usuario | Se cancelan y confirman todas sus renovaciones. Si alguna no se confirma, **no se borra nada** (el ledger se conserva). También se bloquea si hay cobros retenidos sin resolver o si apareció otra autorización durante el proceso. Con todo confirmado: se audita (ids de preapproval, actor) y recién entonces se borra. |
| Cobro aprobado con cuenta **suspendida** | No se acredita: queda registrado y **retenido** (`payments.review_reason='subscription_suspended'`, `applied_at` nulo), incidente `mp_incident_payment_held`, sin cambiar plan, vencimiento ni acceso; se reintenta cancelar la autorización. |
| Cobro **recurrente** con cuenta **cancelada** y autorización ya cerrada | Igual: retenido (`subscription_cancelled`). Un cobro de una autorización **viva** sobre una cuenta cancelada (re-suscripción) y un pago manual sobre cuenta cancelada **sí se acreditan** y reactivan. |
| Resolución | `resolve_held_mp_payment(pago, 'apply' \| 'refund')` (solo admin, en SQL): *apply* extiende el período (una cuenta cancelada vuelve a `active`; una suspendida sigue suspendida: levantar la suspensión es una decisión aparte); *refund* lo marca para reembolso (el reembolso se hace en el panel de MP; cuando MP lo notifica pasa a `refunded`). |
| Cobro de una autorización que ya no figura en el ledger (p.ej. usuario eliminado) | No se acredita; incidente `mp_incident_unknown_preapproval_charge` para conciliación manual. |

Idempotencia/concurrencia: bloqueo de fila en la suscripción (`wind_down`) y en el pago (`record_mp_payment` y `resolve_held_mp_payment` comparten el bloqueo); una notificación repetida de un cobro retenido devuelve `duplicate` (una sola incidencia).

## Decisiones a confirmar
1. Suspender/cancelar **no se bloquea** si MP no responde (es reversible y quitar acceso es lo seguro); sí se bloquea eliminar (irreversible).
2. Tras `cancelRenewal` del propio usuario la suscripción sigue `active`; un cobro tardío de esa autorización se **acredita** con incidente (el usuario tiene acceso y pagó). Solo se retiene con cuenta suspendida/cancelada.
3. El panel solo muestra el aviso; **no hay todavía pantalla** para ver/resolver cobros retenidos ni reintentar (etapa siguiente). Hoy se resuelven con el RPC.

## Pruebas (esta etapa)
- Vitest: `lifecycle.test.ts` (24) y `adminUsers.test.ts` (16): cancelación OK, rechazo, timeout (con y sin confirmación por GET), reintento por cron, idempotencia, simultaneidad, creación en curso, MP sin configurar, cobro aprobado posterior a la suspensión, notificaciones tardías/repetidas, cobro de autorización desconocida, eliminación (OK, rechazo, timeout, reintento, cobros retenidos, autorización nueva, varias suscripciones), permisos de admin.
- SQL (`03_mercadopago.sql`, tests 86–110): wind-down atómico y su rollback, idempotencia, permisos, retención por suspendida/cancelada, re-suscripción, pago manual, resolución admin, reembolso, `search_path`. El test 44 cambió a propósito (antes un pago sobre cuenta suspendida extendía el vencimiento; ahora se retiene).
- Concurrencia real (dos sesiones): dos admins resolviendo el mismo cobro retenido => se aplica una sola vez.
- **Nada de esto se probó contra Mercado Pago real**: la cancelación efectiva, el comportamiento del `PUT`/`GET` y el reintento siguen siendo supuestos hasta el sandbox.

---

# Etapa 1 — correcciones de seguridad (migración 0027)

Migración nueva **0027** (incremental; no modifica 0023–0026; solo probada en Postgres local, no aplicada en remoto).

## 1. Carrera entre `record_mp_payment` y la cancelación
- **Causa:** `record_mp_payment` leía la fila de `mp_preapprovals` sin bloquearla y recién después bloqueaba pago y suscripción. Si una cancelación se confirmaba en el medio, decidía con una autorización obsoleta (`authorized`) y una cuenta ya `cancelled`: acreditaba y la **reactivaba**. Además existía un riesgo de interbloqueo: el trigger espejo toma ledger → suscripción y `mp_begin_wind_down` tomaba suscripción → ledger.
- **Orden único de bloqueos: ledger → pago → suscripción.** `record_mp_payment` (recurrente) bloquea la fila del ledger `FOR UPDATE` primero (si hay una cancelación en curso espera y decide con el estado vigente); `mp_begin_wind_down` y `mp_begin_user_deletion` bloquean el ledger antes que la suscripción; `resolve_held_mp_payment` / `reconcile_transfer_payment` / pago manual siguen pago → suscripción; el trigger espejo ya era ledger → suscripción.
- **Evidencia (sesiones reales, `run_race_record.sh`, `run_deadlock.sh`):** contra la 0026 → T2 **FALLA** (cuenta `active` con autorización `cancelled`) y 56–85 interbloqueos; contra la 0027 → T1–T4 PASS y 0 interbloqueos (3 corridas × 3 sesiones × 400 iteraciones).

## 2. Eliminación de usuarios y nuevas renovaciones
- `mp_begin_user_deletion` (solo `service_role`): activa una **retención de eliminación** (`subscriptions.deletion_hold_at`, vence sola a los 30 min) y pasa las autorizaciones abiertas a `cancelling`. `mp_end_user_deletion_hold` la libera si se aborta.
- **Guardia de alta en base** (trigger espejo): una autorización abierta nueva se rechaza (`mp:renewals_blocked`) si la cuenta está `suspended` o con retención vigente; se evalúa con el estado **vigente** tomando el bloqueo de la suscripción. Una cuenta **cancelada** conserva la re-suscripción normal.
- **Guardia de borrado en base** (`BEFORE DELETE` en `subscriptions`): no se puede borrar una suscripción —ni, en cascada, el usuario— con una autorización abierta o con cancelación sin confirmar (`mp:open_preapproval`). Aunque el código de la app fallara, la base no borra.
- App: `prepareUserDeletion` activa la retención primero, cancela y confirma, y la libera si algo falla; `deleteUser` la libera si falla el borrado; el checkout (recurrente y único) falla rápido durante la retención y traduce el rechazo de la base a un mensaje claro.

## Pruebas de esta corrección
- Vitest (208 en total): `lifecycle.test.ts` 40 (retención antes de MP, rechazo/timeout/errores de base al activar y a mitad, checkout vs. eliminación simultáneos en ambos órdenes, re-suscripción, retención vencida, cuenta suspendida, doble checkout), `adminUsers.test.ts` 17 (se libera la retención si falla el borrado).
- SQL `03_mercadopago.sql` tests 111–129 (guardias, retención y vencimiento, borrado bloqueado/permitido, privilegios, `search_path`).
- Sesiones reales: T1 (cobro procesado tras la cancelación confirmada → retenido), T2 (cobro ya en curso → no reactiva), T3 (alta simultánea vs. retención → rechazada), T4 (alta en curso vs. eliminación → seguimiento) y estrés de interbloqueos.

## Riesgos pendientes
- Un checkout **único** (no recurrente) que empiece justo antes de la retención solo está protegido a nivel de aplicación; si pagara después de borrado el usuario, el cobro quedaría sin atribuir (incidente de conciliación manual por intento sin operación local, ya registrado para recurrentes; para pagos únicos es "intent no encontrado").
- Si el proceso muere con la retención activa, la cuenta no puede iniciar pagos hasta 30 min (vence sola).
- Todo es simulación + Postgres local; falta el sandbox real de MP.

---

# Etapa 1 — pagos únicos durante la eliminación (migración 0028)

Migración nueva **0028** (incremental; no modifica 0022–0027; solo probada en Postgres local, no aplicada en remoto).

## Qué pasaba (auditoría)
- `startOneTime` crea la intención local (`payments`, `pending`) **antes** de llamar a MP y cualquier error —incluido un timeout— la marcaba `rejected`.
- La retención de 0027 era por **suscripción**: una cuenta sin fila en `subscriptions` no tenía dónde retenerse (el checkout crea una "vencida" después).
- La guardia de borrado solo miraba autorizaciones: un pago único pendiente se borraba por cascada junto con la suscripción; el webhook posterior llegaba sin registro local y se ignoraba en silencio.

## Qué hace 0028
- **Retención por usuario** (`mp_deletion_holds`, sin privilegios de usuario, vence a los 30 min, se limpia al borrar el perfil). Funciona sin fila en `subscriptions`.
- **Guardias en la base** (advisory lock compartido por usuario; el eliminador lo toma exclusivo): rechazan con `mp:renewals_blocked` el alta de una suscripción, de una **intención** de pago (`payments` sin `external_id`) y de una autorización. Los cobros reales (`record_mp_payment`, con `external_id`) nunca se bloquean.
- **Guardia de borrado ampliada**: no se borra con autorización abierta, pago `pending` (MP o transferencia) ni cobro retenido sin resolver (`mp:pending_payments`); en la misma transacción del borrado deja en `audit_logs` una instantánea de los pagos de MP (`mp_payments_snapshot_on_delete`).
- `mp_expire_intent`: única vía para cerrar una intención sin pago; solo si tiene > 25 h (vigencia de la preferencia + margen), sin `external_id` y sin aplicar.
- **Orden de bloqueos global**: advisory(usuario) → ledger → suscripción → pago. `record_mp_payment`, `resolve_held_mp_payment` y `reconcile_transfer_payment` ahora bloquean la suscripción **antes** que el pago (igual que una cascada de borrado).

## App
- Timeout, red, 408/429, 5xx o fallo posterior a la creación de la preferencia ⇒ la intención queda **pendiente** (`mp_status='creation_uncertain'`), nunca fallida; solo un 4xx definitivo la marca `rejected`.
- `prepareUserDeletion`: retención → concilia pagos pendientes consultando MP por `external_reference` (mismo camino que el webhook) → si queda algo pendiente/retenido, libera la retención y no borra → cancela autorizaciones → verificación final → auditoría.
- Un pago de MP con nuestra referencia pero sin registro local deja el incidente `mp_incident_payment_without_local_record`.

## Pruebas
- Vitest 223: pagos pendientes vs. eliminación, timeout/incierto, pago aprobado/retenido durante el intento, vencimiento, checkout con retención, cuenta sin suscripción, incidente sin registro local.
- SQL `03_mercadopago.sql` 152 (tests 130–155 de 0028).
- Sesiones reales `run_deletion_race.sh` (D1–D6): cuenta sin suscripción, alta en vuelo, intención en vuelo, cobro vs. eliminación, dos eliminaciones, webhook repetido tras eliminación fallida, estrés cobro/eliminación en cascada.

## Riesgos pendientes
- Un cobro **aprobado y aplicado** no bloquea el borrado: la cuenta se elimina y sus pagos se borran por cascada; queda la instantánea en `audit_logs` (no una tabla de pagos huérfanos).
- Una intención incierta bloquea la eliminación hasta 25 h o hasta que MP informe un pago; no hay cron ni pantalla para esto (fuera de alcance).
- Interbloqueo residual estrecho entre la cascada (suscripción → ledger) y una actualización tardía del ledger sobre filas cerradas.
- Todo es simulación + Postgres local; falta el sandbox real de MP.

---

# Etapa 1 — revisión final (migración 0029)

Migración nueva **0029** (incremental; no modifica 0022–0028; solo probada en Postgres local, no aplicada en remoto).

## 1. Interbloqueo residual: borrado en cascada vs. UPDATE tardío del ledger
- **Participantes:** `DELETE` de `subscriptions` (o de `auth.users` en cascada) y un `UPDATE` sobre una fila **cerrada** de `mp_preapprovals` (p. ej. `markCancelled` o `recordCancelFailure` reintentados por cron o por un segundo admin). Intervienen la cascada de FK `subscriptions → mp_preapprovals`, el trigger `sync_mp_mirror` (AFTER INSERT/UPDATE del ledger) y la guardia `mp_guard_subscription_delete`.
- **Ciclo exacto:**
  1. D (borrado) toma la fila de la suscripción S y ejecuta su trigger de guardia (que solo *lee* el ledger; una fila cerrada no bloquea el borrado).
  2. U toma la fila L del ledger con su `UPDATE`; su trigger `sync_mp_mirror` hace `UPDATE subscriptions` ⇒ espera S (en poder de D).
  3. La cascada de D pide L ⇒ espera a U. D espera L, U espera S ⇒ `40P01`.
  Era la única ruta con orden suscripción → ledger; el resto es ledger → suscripción → pago.
- **Reproducción (sesiones psql reales, `run_ledger_cascade_race.sh`):** un trigger de prueba —solo dentro del script— demora el borrado entre el bloqueo de S y la cascada. Contra una base con 0028 el interbloqueo se reprodujo las **4 de 4** veces (el borrado es la víctima: `deadlock detected`).
- **Corrección mínima:** la guardia `BEFORE DELETE` toma las filas del ledger de esa suscripción con `FOR UPDATE NOWAIT`. El borrado nunca espera al ledger teniendo la suscripción: si otra transacción usa una fila, falla al instante con `mp:ledger_busy` (reintentable, la retención se libera y el admin ve un mensaje de reintento); si no, ya las tiene y la cascada no espera. Un UPDATE tardío que llega después simplemente espera el `COMMIT` del borrado y no encuentra fila. No cambia la idempotencia (`record_mp_payment`, webhooks) ni el orden global advisory → ledger → suscripción → pago.
- **Resultados:** A (ventana determinista) sin interbloqueo y con el borrado completado; B (fila en uso) falla en 0,0 s con `mp:ledger_busy`, todo intacto y el reintento borra; C (estrés: 200 iteraciones × 1 borrado + 3 updates simultáneos con jitter) 0 interbloqueos, 0 otros errores, 0 cuentas sin borrar tras reintento. Más: `run_deadlock.sh` 3 × 400 iteraciones = 0, `run_deletion_race.sh` D6 (60 pares) = 0, T1–T4 y concurrencia previa sin cambios.
- **Alcance de la afirmación:** las pruebas cubren los pares de transacciones identificados (borrado vs. ledger, vs. pago, vs. webhook, vs. cancelación) con sesiones reales y un control que sí falla; no es una prueba formal de ausencia de interbloqueos en cualquier combinación futura de código.

## 2. Conservación de pagos al eliminar una cuenta
- **Desaparece por cascada:** `payments` (incluidos `mp_status_detail`, `reference`, datos de revisión de retenidos, `checkout_url`, `proof_url`), `mp_preapprovals`, `bank_reconciliations`.
- **Instantánea 0028 (insuficiente):** `payment_id`, `external_id`, importe, estado, `mp_status`, plan, fechas y `user_id`. Faltaban moneda, `mp_status_detail`, `reference` de renovaciones, datos de retención/resolución y todo el ledger (ids de preapproval), imprescindible para atribuir cobros recurrentes posteriores; y no había forma de buscar por esos ids.
- **0029:** la instantánea (`audit_logs`, `entity='subscriptions'`, `action='mp_payments_snapshot_on_delete'`, una por suscripción, misma transacción del borrado) ahora incluye por pago: `payment_id` (= `external_reference` de pagos únicos), `external_id` (id en MP), proveedor, importe, **moneda** (`ARS`: `payments` no la almacena, pero `record_mp_payment` la exige antes de registrar cualquier cobro de MP), estados, plan, `reference`, `applied_at`/`created_at`/`updated_at` y revisión; y por autorización: id (= `external_reference`), `preapproval_id`, plan, importe, estado, fechas. Asociación a la cuenta: `user_id` y `subscription_id`. **No** se guardan tokens, email, `checkout_url` ni comprobantes (test 159).
- **Trazado:** `mp_trace_deleted_payment(ref)` (solo `service_role`, con índices GIN parciales) encuentra la cuenta y el registro por id de pago de MP, `external_reference`, id de preapproval o referencia de renovación. El webhook sin registro local (pago único o renovación de una autorización desconocida) lo usa para enlazar su incidente (`deleted_account`) con la cuenta borrada; si el trazado falla, el incidente se registra igual.
- **Un cobro posterior a la eliminación:** `record_mp_payment` lo rechaza (`mp:intent_not_found`) sin crear filas; el incidente queda con su atribución para reembolso/conciliación manual.
- Sigue vigente: no se elimina con pagos pendientes/en proceso/retenidos; un pago aplicado no bloquea.

## Pruebas
- Vitest 226: incidentes enlazados a la cuenta borrada, trazado que falla, mensaje de `mp:ledger_busy`.
- SQL `03_mercadopago.sql` 167 (tests 156–170 de 0029: instantánea completa, sin datos sensibles, trazado por cada identificador, cobro posterior, permisos).
- Sesiones reales: `run_ledger_cascade_race.sh` (A/B/C y control), más todas las anteriores.

## Riesgos pendientes
- La política `audit_logs_insert_authenticated` (0002) permite a cualquier usuario autenticado **insertar** filas de auditoría (no modificarlas ni borrarlas): podría fabricar una instantánea falsa que el trazado devolvería. Es anterior a esta etapa y está fuera de alcance; se recomienda restringirla antes de producción (decisión tuya).
- `bank_reconciliations` y los pagos por transferencia: se conservan en la instantánea solo los datos de `payments` (sin comprobantes ni texto libre del usuario); las notas de conciliación bancaria se pierden por cascada.
- La instantánea es la única copia local tras la eliminación: si se purga `audit_logs`, se pierde el rastro.
- Todo es simulación + Postgres local; falta el sandbox real de MP.

---

# Etapa 1 — cierre (migración 0030)

Migración nueva **0030_mp_audit_integrity_and_payment_delete_guards.sql** (incremental; 0022–0029 intactas, verificadas por hash; solo probada en Postgres local, no aplicada en remoto). Detalle de pruebas y riesgos: `docs/INFORME_ETAPA1_CIERRE.md`.

## 1. `audit_logs` no se puede falsificar desde el cliente
- Trigger `BEFORE INSERT` (`audit_logs_client_guard`) para los roles de cliente `authenticated` / `anon` (se compara el rol *efectivo* `current_user` **por nombre**: `pg_has_role(...,'member')` es verdadero para cualquier superusuario y trataría al dueño de las funciones `SECURITY DEFINER` como cliente). Rechaza: acciones reservadas `mp_*` y `admin_delete_user*` (`audit:reserved_action`), `actor_id` distinto de `auth.uid()` (`audit:actor_mismatch`) y `old_value` (`audit:old_value_forbidden`).
- Única excepción de `old_value`: el respaldo que ya escribe `discard_draft_version()` (función `SECURITY INVOKER` invocada por un administrador: `entity='price_list_versions'`, `action='discard_draft'`, actor propio, `is_admin()`). Se descubrió al auditar 0021; sin esta excepción se rompería esa función.
- Política **RESTRICTIVE** equivalente (se combina con AND: ninguna política permisiva, la de 0002 u otra futura, la neutraliza) y revocación de `UPDATE/DELETE/TRUNCATE` sobre `audit_logs` a los clientes (y de `INSERT` a `anon`). Cada capa se prueba por separado (tests 178a–f).
- Las funciones `SECURITY DEFINER` (la guardia que escribe la instantánea, `record_mp_payment`, etc.) y `service_role` no son roles de cliente y siguen escribiendo.
- Diagnóstico de posibles instantáneas falsas ya existentes (solo lectura, no borra ni modifica): `select * from public.mp_audit_suspicious_snapshots();` (ejecutable por `service_role`/dueño). Marca: `actor_id_no_nulo`, `entidad_inesperada`, `old_value_invalido`, `subscription_id_no_coincide`, `sin_user_id`, `payments_invalido`, `new_value_inesperado`, `suscripcion_todavia_existe`, `pago_todavia_existe` (una instantánea real es de una suscripción y pagos que ya no existen) y `accion_reservada_actor_no_admin`.

## 2. Reembolso pendiente
- `mp_guard_subscription_delete` (y la lista `pending_payment_ids` de `mp_begin_user_deletion`) ahora consideran que requieren conciliación: `status='pending'` **o** `reconciled` + `applied_at null` + (`review_resolution` nulo **o** `refund_pending`). Mismo error `mp:pending_payments`. Resueltos (`refunded`, `applied`) siguen sin bloquear.
- TS: `listPendingPaymentsOfUser` y `countHeldPayments` incluyen `refund_pending`.

## 3. `payments`: borrados directos, cascada y TRUNCATE
- Trigger `BEFORE DELETE` (`mp_guard_payment_delete`). **Cómo distingue la cascada sin `pg_trigger_depth()` ni banderas:** `payments.subscription_id` es `NOT NULL` con FK; si el borrado llega por la cascada de la suscripción, esa suscripción ya fue eliminada por un comando anterior de la misma transacción (la acción de FK corre después) y la consulta del trigger ya no la ve; si la suscripción sigue visible, el borrado es directo. Para fingir una cascada hay que eliminar antes la suscripción, lo que ejecuta `mp_guard_subscription_delete`. No hay ninguna vía de bypass accesible al cliente (ni GUC, ni tabla, ni función).
- Directo ⇒ `mp:direct_payment_delete`, salvo una intención de MP que nunca produjo un pago (rechazada, sin `external_id` ni acreditación).
- Cascada ⇒ rechaza pagos pendientes / retenidos / con reembolso pendiente (`mp:pending_payments`) y cualquier pago sin su instantánea (`mp:snapshot_missing`: protege también si la guardia de suscripción fuera deshabilitada).
- `TRUNCATE` (incluido `... CASCADE` desde `subscriptions`) ⇒ `mp:direct_payment_delete`; `DELETE/TRUNCATE` revocados a los clientes.
- Probado en los tres caminos reales de eliminación: `DELETE` de `auth.users`, de `profiles` y de `subscriptions`.

## Compatibilidad
Se conservan 0028 y 0029. Ajustes de pruebas previas por diseño de 0030: la limpieza del test 143 pasó de `delete` a `update ... 'rejected'` (los pagos ya no se borran), y el test 166 espera `permission denied` (el cliente ya no tiene privilegio `DELETE` sobre `audit_logs`).

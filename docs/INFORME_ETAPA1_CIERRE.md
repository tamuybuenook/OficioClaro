# OficioClaro — Mercado Pago, cierre de la etapa 1 (migración 0030)

> Todo se probó en Postgres local y descartable con simulaciones. **No** está validado contra Mercado Pago real (Sandbox es una etapa posterior). No se declara la etapa aprobada ni Mercado Pago listo para producción: falta tu revisión.

## 1. Archivos
**Nuevos**
- `supabase/migrations/0030_mp_audit_integrity_and_payment_delete_guards.sql`
- `supabase/tests/run_payment_delete_race.sh`
- `docs/INFORME_ETAPA1_CIERRE.md`

**Modificados**
- `supabase/tests/03_mercadopago.sql` (tests 171–215 nuevos; ajustes en 143 y 166)
- `lib/mercadopago/store.ts` (`refund_pending` en `listPendingPaymentsOfUser` y `countHeldPayments`)
- `lib/mercadopago/lifecycle.ts` (mensaje de cobros retenidos)
- `lib/mercadopago/lifecycle.test.ts` (2 pruebas nuevas y fake con `refund_pending`)
- `docs/SEGURIDAD_MP_REVISION.md` (sección "cierre")

Migraciones 0022–0029: sin cambios (hash verificado).

## 2. Correcciones
Ver `docs/SEGURIDAD_MP_REVISION.md`, sección "Etapa 1 — cierre (migración 0030)".

## 3. Resultados reales
| Prueba | Resultado |
|---|---|
| Typecheck (`tsc --noEmit`) | sin errores |
| Build (`npm run build`) | OK |
| Vitest | 228/228 (14 archivos) |
| SQL Mercado Pago (`run_mercadopago.sh`) | 222/222 |
| SQL aceptación (`run_acceptance.sh`) | 94/94 |
| Agenda (`run_agenda.sh`) | 17/18 — falla solo `10 updated_at` |
| Concurrencia (`run_concurrency.sh`) | transferencias PASS, cobro retenido PASS |
| Cobro vs cancelación (`run_race_record.sh`) | T1–T4 PASS |
| Carreras de eliminación (`run_deletion_race.sh`, 60 pares) | D1, D1b, D2, D2b, D3, D4, D5, D6 PASS |
| Interbloqueos (`run_deadlock.sh`, 3 sesiones × 400) | 0 interbloqueos, 0 otros errores |
| Ledger vs cascada (`run_ledger_cascade_race.sh`, 200 iter.) | A, B, C PASS (0 interbloqueos) |
| Control 0028 sin 0029 (mismo script, modo `control`) | interbloqueo reproducido (el escenario sigue siendo real; 0029 lo corrige) |
| Borrado de pagos (`run_payment_delete_race.sh`, 150 iter. × 4 sesiones) | R1, R2, R3 PASS: 0 interbloqueos, 0 errores inesperados, invariante respetado |

## 4. Comparación con fallos conocidos
- Agenda: **17/18**, mismo resultado que la referencia anterior; el único fallo es el conocido `10 updated_at` (sin modificar). Sin regresiones nuevas.
- Los demás resultados no cambian respecto de la entrega anterior (acceptance 94/94; T1–T4, D1–D6, interbloqueos 0).

## 5. Riesgos pendientes
- Un cobro **aprobado y aplicado** no bloquea la eliminación de la cuenta: sus pagos se borran en cascada y queda la instantánea de `audit_logs` (única copia local).
- Un superusuario o el dueño de las tablas puede deshabilitar triggers (`ALTER TABLE ... DISABLE TRIGGER`) o usar `session_replication_role`: fuera del alcance de los roles de la aplicación.
- La protección de `audit_logs` compara el rol efectivo por nombre (`authenticated`, `anon`): si en el futuro se agregaran roles de cliente adicionales habría que incluirlos.
- Sigue vigente la excepción de `old_value` para `discard_draft` (administrador); es una función existente y legítima.
- `mp_audit_suspicious_snapshots()` solo diagnostica: no hay forma de saber con certeza si una fila antigua es falsa; revisar manualmente los resultados antes de cualquier decisión.
- Las notas de `bank_reconciliations` se pierden por cascada con la cuenta.
- El arnés local no concede tablas a `service_role` ni replica los grants por defecto de Supabase; esos puntos se probaron concediendo y revocando dentro de la prueba y por la lógica de roles. Revisar en un entorno Supabase real antes de producción.
- Sin cron ni pantalla de cobros retenidos (fuera de alcance). Mercado Pago real sin validar.

## 6. Producción y remoto
No se desplegó, no se aplicó ninguna migración en Supabase remoto, no hubo cobros reales ni credenciales de producción. Todo corrió en Postgres local descartable.

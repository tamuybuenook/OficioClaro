# Auditoría OficioClaro — reglas vigentes y guía de despliegue

## Reglas de negocio (única fuente de verdad)
- **Precio por UT (maestra y personal):** `round(coeficiente × valor UT, 2)`, aritmética decimal exacta
  (SQL: `round(numeric, 2)`; TS: `lib/money.ts`, verificado contra 400+ vectores generados por PostgreSQL).
- **UT maestra** (`master_ut_history`, `get_master_ut_at(fecha)`): circuito de referencia. Vigencia con fin exclusivo;
  si cambia dos veces el mismo día prevalece el último. Una versión usa la UT vigente **a su fecha de vigencia**
  y la guarda en `reference_ut_value`.
- **UT personal** (`profiles.unit_value` + `ut_history`): solo se cambia con `set_ut_value` / `apply_my_ipc_update`.
  Precedencia del precio personal: `custom_price` > `custom_ut_coefficient × mi UT` > `coeficiente × mi UT` > precio de lista.
- **Versión por IPC:** `precio anterior × (1 + IPC/100)`, sobre la última versión publicada anterior a la nueva vigencia.
  No usa UT ni completa `reference_ut_value` (queda NULL: no fue calculada con una UT). No se puede "regenerar desde UT".
- **Publicación:** solo admin, validada en la base (trigger + `publish_price_list_version`). Una publicada es inmutable
  (UPDATE/DELETE/INSERT de ítems bloqueados). Un borrador puede descartarse (respaldo en `audit_logs`).

## Despliegue seguro
1. Backup de la base (Supabase → Database → Backups, o `pg_dump`).
2. Aplicar primero en un proyecto de staging/branch: `supabase db push` y correr `supabase/diagnostics/oct2026_diagnostic.sql`.
3. La migración `0021` no modifica datos existentes (verificado con hashes antes/después en una réplica del estado descrito).
4. Producción: `supabase db push`, luego desplegar el frontend (las acciones nuevas requieren las funciones SQL de 0021).
5. Verificar con la lista manual del informe.

## Pruebas
- `npm test` — pruebas unitarias (Vitest).
- `npm run test:sql` — suite SQL de aceptación sobre un Postgres local aislado (requiere Postgres en el puerto 5433; ver `supabase/tests/`).
- `npm run typecheck` y `npm run build`.

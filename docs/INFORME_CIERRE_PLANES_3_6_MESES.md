# Cierre — Planes de 3 y 6 meses

## Qué se hizo
Períodos soportados: `monthly` (1), `quarterly` (3), `semiannual` (6), `yearly` (12). Un pago aprobado extiende el acceso exactamente esa cantidad de meses (por Mercado Pago, pago único o renovación automática, y por transferencia conciliada o cobro retenido que el admin aplica).

**Base de datos (migración nueva `0032_plan_periods_3_6_months.sql`, NO aplicada):**
- Amplía el CHECK de `plans.billing_period`.
- Crea `plan_period_months(text)`: 1/3/6/12; un valor desconocido **falla** (`mp:unsupported_plan_period`), nunca se asume mensual.
- Redefine con `create or replace` las tres funciones vigentes (copia exacta de 0028; único cambio: el cálculo de `v_new_end`): `record_mp_payment`, `resolve_held_mp_payment`, `reconcile_transfer_payment`. No se tocó ninguna migración aplicada (0022–0031).

**Aplicación:**
- `lib/plan-period.ts`: única fuente de períodos (meses, textos «mes / 3 meses / 6 meses / año», «mensual / trimestral / semestral / anual»).
- `lib/mercadopago/checkout.ts`: la renovación automática ya no manda `1 o 12`; manda los meses reales. Un período desconocido da error claro **antes** de registrar nada en el ledger o llamar a Mercado Pago.
- Pantallas: selector del admin (4 opciones), tarjeta del plan en admin, landing, «Suscripción» del usuario y paneles de facturación del admin muestran el período correcto. `updatePlan` valida el período en el servidor.

## Pruebas ejecutadas (reales)
- `tsc --noEmit` sin errores · `vitest`: 32 archivos, 374 tests OK · `next build` compila.
- PostgreSQL 16 temporal con las migraciones 0001–0032 aplicadas de cero:
  - `05_plan_periods.sql` (nueva): **19/19 PASS** — CHECK, función auxiliar, pagos de 1/3/6/12 meses, notificación repetida, fin de mes (31/01 + 3 meses = 30/04), transferencia trimestral, cobro retenido semestral, permisos intactos.
  - Sin regresiones: `01_acceptance` 94/94, `03_mercadopago` 222/222, `04_admin_billing_panel` 21/21.
- Nota: por primera vez las pruebas SQL se corrieron en el entorno de Claude (antes figuraban como «no ejecutadas»). `02_agenda` no se re-corrió: usa su propio script (`run_agenda.sh`).

## NO probado
- Contra Supabase ni Mercado Pago reales. **Sandbox de MP**: que acepte una preautorización con `frequency: 3` o `6` (months) y que los cobros sucesivos lleguen por el webhook. Queda dentro de las 10 pruebas Sandbox pendientes (etapa 9).
- Las pantallas en el navegador.

## Cómo aplicar (proyecto de PRUEBA primero)
1. Descomprimí el ZIP sobre el proyecto (reemplazar).
2. Supabase de prueba → SQL Editor → pegá y ejecutá `supabase/migrations/0032_plan_periods_3_6_months.sql`. Es repetible sin dañar datos.
3. Cargá los planes nuevos (el panel admin solo edita planes existentes, no crea). Ejemplo, ajustando precios:
```sql
insert into plans (name, price, billing_period, max_trades, trial_days, is_active) values
  ('Medium Trimestral', 22000, 'quarterly', 3, 0, true),
  ('Medium Semestral', 42000, 'semiannual', 3, 0, true);
```
4. En `/admin/planes` deberían verse «/3 meses» y «/6 meses»; en Suscripción del usuario aparecen en la lista.

## Atención
- **La prueba gratuita se asigna al plan activo sin límite de oficios y de menor precio TOTAL** (`handle_new_profile_trial`, sin mirar el período). Un plan trimestral/semestral «Full» nuevo no lo altera mientras cueste más que el mensual, pero si algún día fuera el más barato, la prueba pasaría a ese plan. No se cambió.
- Las listas ordenan por precio total: un plan semestral aparece después de uno mensual aunque salga más barato por mes.
- Un pago que cambia de plan (p. ej. mensual → trimestral) extiende desde el vencimiento vigente por el período del plan pagado (misma regla de siempre).
- Si más adelante se quiere mostrar «equivale a $X por mes» o descuentos, es un cambio de pantalla aparte.

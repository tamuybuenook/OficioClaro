# Tarea 1 — Administración / Configuración (datos bancarios + ocultar Mercado Pago)

## Cambios
- **Migración `0036_app_settings_pago.sql` (NUEVA, NO aplicada):** hizo falta porque `app_settings` (0031) solo admitía 2 claves con valores enteros. Es aditiva: agrega `text_value`, amplía las claves permitidas y siembra 5 filas (`mp_hidden`, `bank_holder`, `bank_cuit`, `bank_cbu`, `bank_alias`). No crea tablas.
- **Validación (servidor + base):** titular 2–120 caracteres; CUIT/CUIL 11 dígitos (se guarda `XX-XXXXXXXX-X`); CBU/CVU exactamente 22 dígitos; alias opcional 6–20 (letras, números, punto, guion).
- `lib/settings/payment-config.ts`: validadores, lectura tolerante y armado de lo que ve el cliente.
- `lib/actions/appSettings.ts`: `updateBankDetails` y `setMpHidden` (solo admin, con auditoría en `audit_logs`; error claro si falta la migración).
- `app/admin/configuracion/page.tsx` + `components/admin/bank-details-form.tsx` + `mp-visibility-toggle.tsx`: sección de datos bancarios e interruptor.
- `app/page.tsx`: el cliente ve los datos cargados por el admin; si no hay, se usan las variables `TRANSFER_*` como antes. Si MP está oculto, `mpAvailable = false` (solo oculta la sección de pago).

## Despliegue
1. Aplicar `0036` en el proyecto de prueba (SQL Editor) y luego en producción. Hasta entonces: MP visible y datos de transferencia desde variables de entorno (comportamiento anterior).
2. Desplegar el código. Entrar a `/admin/configuracion`, cargar los datos y probar el interruptor.

## Qué NO se tocó
Precios, cálculos, UT, suscripciones, webhooks, credenciales de MP, `startMpCheckout`, `cancelMpRenewal` (el botón "Cancelar renovación automática" sigue disponible con MP oculto).

## Pendientes
- Migración 0036 sin aplicar ni probar contra PostgreSQL real (no había Postgres en el entorno).
- No se validó el dígito verificador del CUIT/CUIL (solo formato de 11 dígitos).
- `startMpCheckout` no se bloquea en el servidor al ocultar MP: se oculta solo la interfaz.

---
# Tarea 2 — Pantalla de pago por transferencia
- `components/features/subscription/subscription-view.tsx` (solo `TransferSection`): muestra Cuenta de, CUIT/CUIL, CBU/CVU (con Copiar) y Alias solo si está informado. Si falta titular, CUIT/CUIL o CBU/CVU, muestra un mensaje claro y no muestra datos parciales ni inventa valores. El aviso de transferencia y la aprobación administrativa no cambiaron.
- Pruebas nuevas en `subscription-view.test.tsx`: visualización, alias ausente, botón Copiar, datos incompletos (3 casos) y sin datos.

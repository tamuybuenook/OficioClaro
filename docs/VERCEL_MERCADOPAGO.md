# Configurar Mercado Pago en Vercel (Preview y Production por separado)

Las credenciales viven **solo** en Vercel (Project → Settings → Environment Variables). No se guardan en la base ni se piden en formularios de OficioClaro. `/admin/configuracion` muestra únicamente si cada variable está presente, nunca su valor.

## Variables

| Variable | Preview | Production |
|---|---|---|
| `MP_ENV` | `test` | `production` |
| `MP_ACCESS_TOKEN` | token de **prueba** de la app | token de **producción** |
| `MP_WEBHOOK_SECRET` | clave secreta del webhook en **modo prueba** | clave secreta del webhook en **modo producción** |
| `APP_URL` | https del preview, sin barra final | https del dominio público |
| `CRON_SECRET` | opcional (los cron no corren en Preview) | **obligatoria** para la conciliación |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | del Supabase de pruebas | del Supabase de producción |

Pasos exactos:
1. Vercel → proyecto → *Settings* → *Environment Variables* → *Add*.
2. Cargar cada variable **marcando solo el entorno que corresponde** (Preview *o* Production; nunca ambos con el mismo valor). Las de Production tildan solo «Production»; las de prueba solo «Preview» (y «Development» si se usa `vercel dev`).
3. Marcar `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` y `CRON_SECRET` como *Sensitive*.
4. `CRON_SECRET`: generar un valor largo al azar (`openssl rand -hex 32`). Vercel lo envía solo como `Authorization: Bearer …` al invocar el cron.
5. Redeploy: las variables nuevas no afectan despliegues ya hechos.
6. Verificar en `/admin/configuracion`: entorno detectado, «Coherente», variables «Presentes», URL del webhook.

Salvaguarda del código: `MP_ENV=test` es obligatorio fuera de Production y `MP_ENV=production` obligatorio en Production (si no, el servidor rechaza operar).

## Webhook en Mercado Pago
Panel de MP → *Tus integraciones* → la app → *Webhooks*. Configurar **por separado** el modo prueba (URL del Preview) y el modo producción (URL de Production):

- URL: `https://<dominio>/api/mercadopago/webhook` (la muestra `/admin/configuracion`).
- Eventos: **Pagos** (`payment`), **Planes y suscripciones** (`subscription_preapproval`) y **Pagos recurrentes** (`subscription_authorized_payment`).
- Copiar la *clave secreta* de cada modo a `MP_WEBHOOK_SECRET` del entorno correspondiente.

## Conciliación periódica (cron)
`vercel.json` declara `GET /api/mercadopago/reconcile` una vez por día (`0 9 * * *`, UTC = 06:00 en Argentina).

Límites de Vercel (docs oficiales, verificados el 18/10/2026 en vercel.com/docs/cron-jobs/usage-and-pricing):
- **Hobby**: como máximo una ejecución por día y precisión de ±59 minutos. Una expresión más frecuente **hace fallar el deploy**. Por eso el valor por defecto es diario.
- **Pro/Enterprise**: hasta una vez por minuto. Para cobros más ágiles cambiar a, p. ej., `*/15 * * * *` en `vercel.json` **y** actualizar `RECONCILE_CRON_SCHEDULE` en `lib/admin/billing/mp-settings.ts` (una prueba falla si no coinciden).
- Los cron se ejecutan en el despliegue de **Production**, no en Preview. En Preview se prueba invocando la ruta a mano.
- La conciliación mira intentos de los últimos 72 h: una ejecución diaria es suficiente para no perder cobros, pero un pago aprobado puede tardar hasta un día en reflejarse si el webhook falló.

### Estado: NO verificado
El cron está **preparado, no comprobado**. Se considera activo recién cuando se cumplan las tres cosas:
1. *Vercel → proyecto → Settings → Cron Jobs* lista la ruta tras el deploy de Production.
2. Se ejecuta a mano: `curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/mercadopago/reconcile` → `200` con `{payments, preapprovals}` (sin cabecera: `401`; sin `CRON_SECRET` configurada: `404`).
3. `/admin/configuracion` → «Conciliación periódica» pasa a «Última ejecución correcta» con la fecha real (cada ejecución deja un registro `mp_reconcile_run` / `mp_reconcile_failed` en `audit_logs`).

## Modo temporal «solo recepción» (solo pruebas)
Variable opcional `MP_WEBHOOK_RECEIPT_ONLY`. **Solo** el texto exacto `true` **y** `MP_ENV=test` lo activan; con `MP_ENV=production` no tiene ningún efecto.
- Efecto: una notificación POST que hoy daría `401`/`400` (sin `data.id`, firma que no coincide, sin `x-request-id`, ids contradictorios) responde **HTTP 200** con `{"outcome":"received_unverified","verified":false,"processed":false}` y queda registrada en `mp_webhook_events` con `outcome=received_unverified`.
- **200 = «llegó», no «aprobado».** No consulta a Mercado Pago, no toca pagos, suscripciones ni accesos, y no guarda el `data.id`/`id` no verificado.
- Una notificación con firma válida y `data.id` sigue el flujo normal (consulta a la API, importe, idempotencia).
- Quitar la variable (y redeploy) al terminar las pruebas: mientras esté activa, cualquiera que conozca la URL puede crear filas de registro.

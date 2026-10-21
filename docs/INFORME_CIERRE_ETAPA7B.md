# Cierre — Etapa 7b: avisos en pantalla (cierra la etapa 7)

## Qué se hizo
- **Inicio (`app/page.tsx`)**: al cargar, sincroniza los avisos del usuario con su situación real (reutiliza el acceso ya calculado; en paralelo con el resto de las consultas) y lee sus avisos abiertos. Costo típico: 2 consultas extra por carga (pagos + avisos abiertos) más 1 lectura de avisos; la escritura solo ocurre si algo cambió.
- **Banner** (`lib/notifications/banner.ts`, pura): bloqueado → aviso de bloqueo (explica por qué solo ve Suscripción); si no, el aviso abierto de **mayor prioridad** (suspensión > gracia > pago fallido > avisos > informativos). Si no se pudieron sincronizar o leer los avisos, **cae al aviso calculado por fase de 6c**: el banner no desaparece por un error técnico.
- **Textos** (`lib/notifications/messages.ts`): uno por tipo, listos para reutilizar en los correos de la etapa 8.
- **Descartar**: botón «Entendido» solo en el informativo «pago confirmado» (`lib/actions/notifications.ts` → `dismiss_notification`; la base verifica dueño y tipo). Los avisos de estado de cuenta no se descartan: se cierran solos al regularizar.
- Los avisos de estado de cuenta llevan el botón «Ver suscripción».

## Pruebas ejecutadas (reales)
- `tsc` sin errores · `vitest`: 37 archivos, **416 tests OK** (con PostgreSQL local encendido; sin él, 1 prueba de contrato queda «omitida», igual que `classify.sql.test.ts`) · `next build` compila.
- Nueva prueba de contrato contra PostgreSQL REAL: los avisos que genera TypeScript para las 10 variantes de fase (los 8 tipos) son aceptados por `sync_notifications` y repetir no duplica (dentro de una transacción que se deshace).
- Las pruebas SQL de 7a (26/26) y anteriores no cambiaron (no hubo cambios de SQL en 7b).

## NO probado
- En navegador ni contra Supabase real (aspecto del banner en los temas claro/oscuro, clic en «Entendido»).
- Requiere `0033` aplicada y `SUPABASE_SERVICE_ROLE_KEY` en Vercel (ya la usa el webhook). **Sin `0033` la página sigue funcionando**: la sincronización falla en silencio y el banner usa el aviso por fase.

## Cómo probar (proyecto de PRUEBA)
1. Ejecutar `0033_notifications.sql` (si no está).
2. Con un usuario de prueba con suscripción `active` y vencimiento en 3 días (`update subscriptions set status='active', end_date = current_date + 3 where user_id='<ID>';`): al recargar, banner amarillo «Tu suscripción vence el… (en 3 días)». Verificar con `select kind, status from notifications where user_id='<ID>';` (una fila `manual_due_soon`).
3. Recargar varias veces: sigue habiendo **una** fila. Mover `end_date` a +30 días y recargar: la fila pasa a `resolved` y el banner desaparece.
4. Con un pago confirmado reciente (`status='reconciled'`): banner azul «¡Recibimos tu pago!…» con «Entendido»; al tocarlo desaparece y no vuelve.

## Pendiente
- Los avisos en pantalla no dependen del cron: se calculan al entrar. Los correos (etapa 8) sí necesitan el cron diario y el proveedor de email (decisión pendiente).

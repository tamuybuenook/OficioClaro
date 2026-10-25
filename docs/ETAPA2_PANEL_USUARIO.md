# Etapa 2 — Panel de usuario (Inicio, Mi suscripción, Mi perfil)

Estado: implementado y probado **en local**. No se desplegó, no se tocó producción, **no hay migraciones**.
No se modificaron autenticación, roles, RLS, acceso administrativo, activación/vencimiento de suscripciones, la conciliación de la Etapa 1 ni Mercado Pago.

## 1. Auditoría (resumen)
Git: la copia recibida no es un repositorio Git (viene de un ZIP), así que no pude revisar cambios pendientes ni ramas.

| Dato | De dónde sale hoy |
|---|---|
| Plan, estado, vencimiento | `subscriptions` + `plans` (`getMySubscription`), estado visible con `displayState`; fase de acceso y `daysToEnd` calculados **en el servidor** con la fecha de Argentina (`getMyAccess`, `getSubscriptionPhase`). |
| Pagos | `payments` (`getMyPayments`): `status` ∈ pending / reconciled / rejected / refunded; `provider` ∈ transfer / mercadopago; `amount`, `reference`, `proof_url`, `created_at`. |
| Avisos | Banner existente (`notifications` + fases). |
| Datos para transferir a OficioClaro | **No existen en ninguna tabla** (`app_settings` solo guarda días numéricos). No se inventaron. |
| Motivo de un rechazo | Vive en `bank_reconciliations`, legible solo por administradores (RLS). El usuario **no puede** verlo sin cambiar RLS o crear migración: no se hizo. |

Problemas encontrados:
1. Inicio: vencimiento en formato ISO crudo, sin días restantes, estado solo verde/ámbar.
2. **"Informar pago" descartaba el resultado**: ni confirmación ni errores (monto inválido, límite de frecuencia, etc.).
3. Sin instrucciones de a qué cuenta transferir.
4. Historial: sin referencia, sin explicación de estados, sin vacío claro, máximo 10.
5. Perfil: mostraba el código interno del estado (`past_due`), mezclaba "datos de cobro a clientes" con el pago a OficioClaro, y usaba `window.prompt/confirm/alert`.
6. **Privacidad**: `getMyPayments` no filtraba por usuario y la RLS deja leer todos los pagos a un administrador; un admin habría visto pagos ajenos en su panel de usuario (comprobado en SQL real, prueba S11). Ahora filtra por dueño.
7. El prompt de UT quitaba todo lo que no fuera dígito ("1.500,50" se convertía en 150050). Ahora se interpreta bien y admite decimales (la columna es `numeric(12,2)`).

## 2. Qué cambió
- **Inicio**: tarjeta "Estado de cuenta" (plan, estado real, "Acceso hasta DD/MM/AAAA", "Vence en N días" / "Venció hace N días"), acción concreta según el estado (Elegir un plan · Pagar mi renovación · Informar una transferencia · Ver el estado de mi pago · Revisar mi pago) y avisos internos (transferencia en revisión / rechazada reciente). Sin notificaciones push.
- **Mi suscripción**: estado con días restantes; aviso "transferencia en revisión"; sección "Pagar por transferencia" en 3 pasos con los datos para transferir (alias/CBU con botón copiar), monto sugerido del plan, nº de operación y enlace opcional al comprobante, confirmación o error real, protección de doble clic; historial con fecha, importe, medio, estado, referencia y explicación, "Ver pagos anteriores". La sección de Mercado Pago quedó como estaba.
- **Mi perfil**: secciones "Mi suscripción a OficioClaro", "Mis datos", "Datos de cobro a mis clientes" (aclarando que no son para pagar a OficioClaro), "Mi trabajo" (clientes, oficios, UT, histórico, IPC). UT e IPC se editan/confirman en pantalla, sin ventanas emergentes. Todas las funciones previas se conservan.
- Servidor: `getMyPayments` filtra por dueño y limita a 50; `lib/account-summary.ts` (lógica pura de estados/avisos/acción) y `lib/transfer-instructions.ts`.

## 3. Archivos (15 + este informe)
Modificados: `app/page.tsx`, `components/app-shell.tsx`, `components/features/profile/profile-view.tsx`, `components/features/subscription/subscription-view.tsx`, `lib/services/payments.ts`, `lib/services/subscriptions.test.ts`.
Nuevos: `components/features/account/account-summary-card.tsx` (+ test), `lib/account-summary.ts` (+ test), `lib/transfer-instructions.ts`, `lib/decimal.ts`, tests de `profile-view` y `subscription-view`, `supabase/tests/09_user_scope.sql`, `supabase/tests/run_user_scope.sh`.

## 4. Pruebas (resultados reales, locales)
Sobre el código original + Etapa 1 + Etapa 2 (árbol independiente): `tsc` sin errores; `next build` compila; **Vitest 54 archivos, 715 pruebas, todas pasan** (incluye las que corren contra PostgreSQL real).
Nuevas: estados de cuenta, días restantes, acción sugerida y avisos (25); Mi suscripción (19: estados, historial vacío/estados reales/desconocido/paginación, instrucciones, envío con éxito, error de servidor, error de red, doble clic, monto inválido, sin controles de aprobación); Inicio (7); Perfil (11: secciones, navegación, UT con formato argentino y errores, IPC en pantalla sin `confirm`, cierre de sesión); lectura de pagos solo del usuario.
SQL real (`run_user_scope.sh`, **12/12**): un usuario ve solo sus pagos/suscripción/perfil; no ve motivos internos de rechazo; no puede activar su suscripción, aprobar, modificar ni borrar pagos; un admin sí ve todos (por eso el filtro).
Pruebas de mutación: volver el cierre de sesión del perfil a un `<form>` simple hace fallar su prueba.

## 5. Despliegue
1. Dependencias de prueba (solo desarrollo): `pnpm add -D jsdom@25 @testing-library/react@16 @testing-library/dom@10 @testing-library/user-event@14`.
2. Copiar los archivos del ZIP sobre el repo (rama aparte / preview de Vercel primero).
3. **Datos para transferir** (opcional pero recomendado): en Vercel → Environment Variables (solo servidor, SIN prefijo `NEXT_PUBLIC_`): `TRANSFER_ALIAS` y/o `TRANSFER_CBU` (al menos uno), y opcionalmente `TRANSFER_BANK`, `TRANSFER_HOLDER`, `TRANSFER_HOLDER_CUIT`, `TRANSFER_NOTE`. Sin ellas, la pantalla dice "los datos todavía no están publicados… escribinos". Son datos de cobro, no secretos; se envían solo a usuarios con sesión.
4. Verificar en el preview con un usuario de prueba: Inicio (tarjeta y fecha), Mi suscripción (datos de transferencia, informar un pago de prueba y ver "En revisión"), Mi perfil (UT, IPC, cerrar sesión). Con el admin, comprobar que "Mi suscripción" muestra solo SUS pagos.
5. Reversión: volver al despliegue anterior (sin cambios de base).

## 6. Limitaciones
- **No verificado en producción ni en navegador/celular real**: diseño móvil primero (campos ≥ 44 px, una columna) probado con jsdom, no con un dispositivo.
- Un pago rechazado no muestra el motivo al usuario (requeriría cambiar RLS/migración; no se hizo). Se le indica escribir con su comprobante; no se inventó un canal de contacto.
- Los avisos nuevos son solo de transferencias (el resto de avisos sigue en el banner existente). El umbral "por vencer" usa el valor inicial de 5 días, no el configurable por admin.
- "Informar pago" sigue sin elegir plan: el vencimiento se extiende según el plan actual de la suscripción (regla existente, no modificada).
- Permanecen ventanas emergentes fuera del alcance (detalle de cliente, panel admin, diálogo de oficios).
- Mercado Pago: el código existente no se tocó; si estuviera configurado en producción seguiría apareciendo su sección.

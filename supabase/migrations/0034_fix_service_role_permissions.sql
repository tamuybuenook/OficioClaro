-- 0034_fix_service_role_permissions.sql — Privilegios de TABLA del rol service_role, limitados a lo que el código usa.
-- NO se aplica sola: ejecutar manualmente (primero en un proyecto de prueba) y verificar con
-- supabase/diagnostics/0034_verify_service_role_grants.sql. Ver docs/INFORME_DIAGNOSTICO_MP_0034.md.
--
-- Por qué existe: ninguna migración 0001–0033 concede privilegios de TABLA a service_role (solo EXECUTE de funciones); dependían de los
-- privilegios por defecto de Supabase. Una consulta de permisos informó que service_role no puede leer plans/subscriptions/payments.
-- Esta migración los deja explícitos y mínimos. Es idempotente: conceder un privilegio ya concedido no cambia nada.
--
-- Qué NO hace a propósito (frente a un «GRANT ALL … ALL TABLES»):
--   · no concede DELETE/TRUNCATE/REFERENCES/TRIGGER (el código nunca borra tablas con service_role; el borrado de cuentas es auth.admin.deleteUser y RPC SECURITY DEFINER);
--   · no toca tablas que el servidor no usa directamente (trial_claims, rate_limits, price_*, catálogo, agenda…);
--   · no toca secuencias (no hay serial/identity: los ids son uuid) ni ALTER DEFAULT PRIVILEGES (no abre tablas futuras sin revisión);
--   · no cambia nada de anon/authenticated ni las políticas RLS (service_role las omite igual).
-- Fuente de cada línea: lib/mercadopago/store.ts, reconcile-log.ts, lib/actions/adminUsers.ts, lib/notifications/sync.ts, lib/services/access.ts.

grant select, insert, update on public.payments          to service_role;  -- intención de pago, búsqueda de pendientes, sync de avisos
grant select, insert, update on public.subscriptions     to service_role;  -- suscripción vencida inicial, altas/cambios desde el admin
grant select                 on public.plans             to service_role;  -- precio y período al iniciar el cobro
grant select, update         on public.profiles          to service_role;  -- acceso (rol) y cambios de rol desde el admin
grant select, insert, update on public.mp_preapprovals   to service_role;  -- ledger de renovaciones automáticas
grant select, insert, update on public.mp_webhook_events to service_role;  -- registro de notificaciones (insert … returning id exige select)
grant insert                 on public.audit_logs        to service_role;  -- incidencias y conciliación (solo se inserta)
grant select                 on public.mp_deletion_holds to service_role;  -- retención por eliminación de cuenta
grant select                 on public.notifications     to service_role;  -- sincronización de avisos
grant select                 on public.app_settings      to service_role;  -- política de gracia/avisos (computeAccess con cliente admin)

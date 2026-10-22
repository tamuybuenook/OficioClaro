-- VERIFICACIÓN DE SOLO LECTURA (no modifica nada). Ejecutar en el SQL Editor de Supabase ANTES y DESPUÉS de aplicar 0034.
-- Cada fila es un privilegio que el código necesita de service_role. «concedido» debe ser true en todas.
-- Si alguna fila sale en false o «no existe», esa es la evidencia concreta de qué falta.

-- 1) Privilegios de tabla que el código usa (ver 0034_fix_service_role_permissions.sql).
with need(tabla, privilegio) as (values
  ('payments','select'),('payments','insert'),('payments','update'),
  ('subscriptions','select'),('subscriptions','insert'),('subscriptions','update'),
  ('plans','select'),
  ('profiles','select'),('profiles','update'),
  ('mp_preapprovals','select'),('mp_preapprovals','insert'),('mp_preapprovals','update'),
  ('mp_webhook_events','select'),('mp_webhook_events','insert'),('mp_webhook_events','update'),
  ('audit_logs','insert'),
  ('mp_deletion_holds','select'),
  ('notifications','select'),
  ('app_settings','select'))
select n.tabla, n.privilegio,
       case when to_regclass('public.' || n.tabla) is null then 'no existe'
            when has_table_privilege('service_role', to_regclass('public.' || n.tabla), n.privilegio) then 'true' else 'false' end as concedido
from need n
order by (case when to_regclass('public.' || n.tabla) is not null and has_table_privilege('service_role', to_regclass('public.' || n.tabla), n.privilegio) then 1 else 0 end), n.tabla, n.privilegio;

-- 2) EXECUTE de las funciones que llama el servidor con service_role (ya concedido por migraciones 0023–0033).
with f(firma) as (values
  ('public.record_mp_payment(uuid,uuid,text,text,text,numeric,text,text)'),
  ('public.sync_notifications(uuid,jsonb)'),
  ('public.rate_limit_hit(text,integer,integer)'),
  ('public.mp_begin_user_deletion(uuid,uuid)'),
  ('public.mp_end_user_deletion_hold(uuid)'),
  ('public.mp_begin_wind_down(uuid,text,uuid,uuid)'),
  ('public.mp_expire_intent(uuid)'),
  ('public.mp_trace_deleted_payment(text)'))
select firma,
       case when to_regprocedure(firma) is null then 'no existe'
            when has_function_privilege('service_role', to_regprocedure(firma), 'execute') then 'true' else 'false' end as ejecutable
from f order by 2, 1;

-- 3) El rol en sí: uso del esquema y si omite RLS (service_role debería: schema_usage=true, omite_rls=true).
select has_schema_privilege('service_role', 'public', 'usage') as schema_usage,
       (select rolbypassrls from pg_roles where rolname = 'service_role') as omite_rls,
       current_user as ejecutando_como;

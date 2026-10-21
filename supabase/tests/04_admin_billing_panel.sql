-- Pruebas SQL del panel /admin/facturacion y /admin/configuracion (solo LECTURA; no hay migración nueva).
-- Verifica, contra el esquema real hasta 0030, que:
--   · un admin lee con RLS exactamente las columnas que consulta el panel;
--   · un usuario común NO ve pagos ajenos, eventos de webhook, autorizaciones ni auditoría;
--   · las relaciones usadas en los embeds de PostgREST no son ambiguas (un FK entre cada par) o llevan pista;
--   · ni admin ni usuario pueden alterar pagos desde el navegador (rol authenticated).
\set ON_ERROR_STOP on
\pset tuples_only on
create schema if not exists t;
grant usage on schema t to anon, authenticated, service_role;
create table if not exists t.results(n serial, name text, ok boolean, detail text);
grant all on t.results to anon, authenticated, service_role; grant usage on all sequences in schema t to anon, authenticated, service_role;
create or replace function t.check(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin insert into t.results(name, ok, detail) values (p_name, coalesce(p_ok,false), p_detail); end $$;
create or replace function t.err(p_name text, p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  begin execute p_sql; perform t.check(p_name, false, 'no falló'); return;
  exception when others then perform t.check(p_name, sqlerrm ilike '%'||p_pattern||'%', sqlerrm); end;
end $$;
create or replace function t.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end $$;
create or replace function t.su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000b1','admin@t.com'),
 ('00000000-0000-0000-0000-0000000000b2','ana@t.com'),
 ('00000000-0000-0000-0000-0000000000b3','beto@t.com');
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1';
update profiles set full_name = 'Ana Pérez' where id = '00000000-0000-0000-0000-0000000000b2';

do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000b1';
  ana uuid := '00000000-0000-0000-0000-0000000000b2';
  beto uuid := '00000000-0000-0000-0000-0000000000b3';
  sa uuid; sb uuid; plan uuid; n int; pa uuid;
begin
  select id into sa from subscriptions where user_id = ana;
  select id into sb from subscriptions where user_id = beto;
  select id into plan from plans where name = 'Medium';
  insert into payments(subscription_id, provider, amount, status, external_id, plan_id, mp_status, applied_at) values
    (sa, 'mercadopago', 8000, 'reconciled', 'MP-1', plan, 'approved', now()) returning id into pa;
  insert into payments(subscription_id, provider, amount, status, plan_id) values (sa, 'transfer', 8000, 'pending', plan);
  insert into payments(subscription_id, provider, amount, status, external_id, plan_id, mp_status, review_reason) values
    (sb, 'mercadopago', 9000, 'reconciled', 'MP-2', plan, 'approved', 'subscription_suspended');
  insert into mp_webhook_events(topic, data_id, outcome, detail) values ('payment', 'MP-1', 'processed', null), ('payment', 'MP-2', 'error', 'db down');
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status, last_error) values (sa, plan, 8000, 'PRE-1', 'cancelling', 'timeout');
  insert into audit_logs(actor_id, entity, entity_id, action, new_value) values
    (null, 'payments', pa, 'mp_approved', '{"end_date":"2026-11-05"}'),
    (null, 'mp_reconcile', null, 'mp_reconcile_run', '{"payments":{"checked":1,"processed":0,"errors":0}}'),
    (null, 'mp_preapprovals', null, 'mp_incident_cancel_unconfirmed', '{}');

  -- ===== Admin: lee todo lo que el panel necesita, con las columnas exactas =====
  perform t.as_user(adm);
  select count(*) into n from (
    select p.id, p.created_at, p.updated_at, p.amount, p.provider, p.status, p.external_id, p.reference, p.proof_url, p.mp_status, p.mp_status_detail,
           p.applied_at, p.review_reason, p.review_resolution, p.reviewed_at, p.reviewed_by, p.plan_id, p.subscription_id, p.checkout_url,
           pl.name, pl.price, pl.billing_period, s.user_id, s.status, s.start_date, s.end_date, s.mp_status, s.mp_preapproval_id, pr.full_name, pr.phone, pr.created_at
      from payments p left join plans pl on pl.id = p.plan_id left join subscriptions s on s.id = p.subscription_id left join profiles pr on pr.id = s.user_id) x;
  perform t.check('A1 admin lee los 3 pagos con plan, suscripción y perfil', n = 3, n::text);
  select count(*) into n from (select id, status, start_date, end_date, created_at, cancelled_at, mp_status, mp_preapproval_id, mp_amount, trial_pending, plan_id from subscriptions) x;
  perform t.check('A2 admin lee suscripciones con las columnas del panel', n >= 3, n::text);
  select count(*) into n from (select id, subscription_id, preapproval_id, status, amount, last_error, cancel_attempts, created_at, updated_at, closed_at from mp_preapprovals) x;
  perform t.check('A3 admin lee autorizaciones recurrentes', n = 1, n::text);
  select count(*) into n from (select id, topic, data_id, request_id, outcome, detail, received_at, processed_at from mp_webhook_events) x;
  perform t.check('A4 admin lee eventos de webhook', n = 2, n::text);
  select count(*) into n from (select id, entity_id, action, new_value, created_at, actor_id, entity from audit_logs where action like 'mp_incident%' or action = 'mp_reconcile_run' or action = 'mp_approved') x;
  perform t.check('A5 admin lee auditoría (incidencias, conciliación y fecha de período)', n = 3, n::text);
  select count(*) into n from (select id, status, notes, reconciled_by, created_at from bank_reconciliations) x;
  perform t.check('A6 admin lee conciliaciones bancarias', n >= 0, n::text);
  select count(*) into n from (select id, full_name, phone, role, created_at from profiles) x;
  perform t.check('A7 admin lee todos los perfiles', n = 3, n::text);
  select count(*) into n from audit_logs where action in ('mp_reconcile_run', 'mp_reconcile_failed');
  perform t.check('A8 admin ve el registro de conciliación', n = 1, n::text);

  -- ===== Usuario común: aislamiento =====
  perform t.as_user(ana);
  select count(*) into n from payments;                perform t.check('B1 Ana ve solo sus 2 pagos', n = 2, n::text);
  select count(*) into n from mp_webhook_events;       perform t.check('B2 Ana no ve eventos de webhook', n = 0, n::text);
  select count(*) into n from mp_preapprovals;         perform t.check('B3 Ana no ve autorizaciones (ledger)', n = 0, n::text);
  select count(*) into n from audit_logs;              perform t.check('B4 Ana no ve la auditoría', n = 0, n::text);
  select count(*) into n from profiles;                perform t.check('B5 Ana ve solo su perfil', n = 1, n::text);

  -- ===== Nadie cambia estado financiero desde el navegador =====
  perform t.as_user(adm);
  perform t.err('C1 ni el admin borra pagos con el rol authenticated', 'delete from payments', 'permission denied');
  perform t.err('C2 el admin no inserta eventos de webhook', 'insert into mp_webhook_events(topic) values (''x'')', 'permission denied');
  perform t.err('C3 el admin no inserta registros de conciliación falsos', 'insert into audit_logs(actor_id, entity, action, new_value) values (auth.uid(), ''mp_reconcile'', ''mp_reconcile_run'', ''{}'')', 'audit:reserved_action');
  perform t.su();
end $$;

-- ===== Relaciones usadas en los embeds de PostgREST =====
do $$
declare
  fk_count int;
begin
  select count(*) into fk_count from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.payments'::regclass and c.confrelid = 'public.plans'::regclass;
  perform t.check('D1 payments→plans: una sola relación (embed sin ambigüedad)', fk_count = 1, fk_count::text);
  select count(*) into fk_count from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.payments'::regclass and c.confrelid = 'public.subscriptions'::regclass;
  perform t.check('D2 payments→subscriptions: una sola relación', fk_count = 1, fk_count::text);
  select count(*) into fk_count from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.subscriptions'::regclass and c.confrelid = 'public.profiles'::regclass;
  perform t.check('D3 subscriptions→profiles: una sola relación', fk_count = 1, fk_count::text);
  select count(*) into fk_count from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.mp_preapprovals'::regclass and c.confrelid = 'public.subscriptions'::regclass;
  perform t.check('D4 mp_preapprovals→subscriptions: una sola relación', fk_count = 1, fk_count::text);
  select count(*) into fk_count from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.subscriptions'::regclass and c.confrelid = 'public.plans'::regclass;
  perform t.check('D5 subscriptions→plans tiene 2 relaciones: todo embed debe llevar pista (plans!subscriptions_plan_id_fkey)', fk_count = 2 and exists (select 1 from pg_constraint where conname = 'subscriptions_plan_id_fkey'), fk_count::text);
end $$;

\echo ===== RESULTADOS =====
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '   -> ' || coalesce(detail,'') end from t.results order by n;
select 'TOTAL: ' || count(*) || '  PASS: ' || count(*) filter (where ok) || '  FAIL: ' || count(*) filter (where not ok) from t.results;

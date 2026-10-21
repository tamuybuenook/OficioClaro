-- Pruebas SQL de la migración 0033 (notifications). DB de PRUEBAS aislada (run_notifications.sh).
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
-- Un aviso deseado, como lo arma la aplicación.
create or replace function t.d(p_kind text, p_key text, p_sev text default 'warning') returns jsonb language sql as $$
  select jsonb_build_object('kind', p_kind, 'dedupe_key', p_key, 'severity', p_sev, 'due_date', '2026-11-30', 'source', 'subscription',
                            'action', jsonb_build_object('label','Ir a Suscripción','url','/?vista=suscripcion'), 'payload', jsonb_build_object('end_date','2026-11-30')) $$;

insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000d1','n1@t.com',now()), ('00000000-0000-0000-0000-0000000000d2','n2@t.com',now()),
 ('00000000-0000-0000-0000-0000000000d3','adm@t.com',now()), ('00000000-0000-0000-0000-0000000000d4','n4@t.com',now());
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000d3';

do $$
declare
  n1 uuid := '00000000-0000-0000-0000-0000000000d1'; n2 uuid := '00000000-0000-0000-0000-0000000000d2';
  adm uuid := '00000000-0000-0000-0000-0000000000d3'; n4 uuid := '00000000-0000-0000-0000-0000000000d4';
  r jsonb; k1 text := 'payment_failed:s1:2026-11-30'; k2 text := 'payment_confirmed:s1:p1'; id2 uuid; id1 uuid; ok boolean; c int;
begin
  -- ---- permisos ----
  perform t.as_user(n1);
  perform t.err('1 el usuario no inserta avisos', format($f$insert into notifications(user_id,kind,dedupe_key,severity) values (%L,'payment_failed','x','warning')$f$, n1), 'permission denied');
  perform t.err('2 el usuario no modifica avisos', $f$update notifications set status = 'dismissed'$f$, 'permission denied');
  perform t.err('3 el usuario no borra avisos', $f$delete from notifications$f$, 'permission denied');
  perform t.err('4 el usuario no ejecuta sync_notifications', format($f$select sync_notifications(%L,'[]'::jsonb)$f$, n1), 'permission denied');
  perform t.su();

  -- ---- sincronización: crear e idempotencia ----
  set local role service_role;
  r := sync_notifications(n1, jsonb_build_array(t.d('payment_failed', k1), t.d('payment_confirmed', k2, 'info')));
  reset role;
  perform t.check('5 crea los avisos deseados', (r->>'created')::int = 2 and (select count(*) from notifications where user_id = n1 and status = 'open') = 2, r::text);
  set local role service_role;
  r := sync_notifications(n1, jsonb_build_array(t.d('payment_failed', k1), t.d('payment_confirmed', k2, 'info')));
  reset role;
  perform t.check('6 repetir la sincronización no duplica ni cambia nada', r = '{"created":0,"reopened":0,"resolved":0}'::jsonb and (select count(*) from notifications where user_id = n1) = 2, r::text);
  perform t.check('7 los campos de correo nacen en none', (select count(*) from notifications where user_id = n1 and email_status = 'none' and email_attempts = 0) = 2);
  perform t.err('8 un tipo de aviso inválido se rechaza', format($f$select sync_notifications(%L, jsonb_build_array(t.d('inventado','kx')))$f$, n1), 'notifications_kind_check');
  perform t.err('9 más de 20 avisos se rechaza', format($f$select sync_notifications(%L, (select jsonb_agg(t.d('payment_failed','k'||g)) from generate_series(1,21) g))$f$, n1), 'Demasiados');
  perform t.err('10 una lista que no es arreglo se rechaza', format($f$select sync_notifications(%L, '{}'::jsonb)$f$, n1), 'arreglo');
  perform t.check('11 los rechazos no dejaron basura', (select count(*) from notifications where user_id = n1) = 2);

  -- ---- resolución por estado real y reapertura ----
  update notifications set email_status = 'sent', email_attempts = 1, email_sent_at = now() where dedupe_key = k1;
  set local role service_role; r := sync_notifications(n1, '[]'::jsonb); reset role;
  perform t.check('12 lo que ya no corresponde se resuelve', (r->>'resolved')::int = 2 and (select count(*) from notifications where user_id = n1 and status = 'resolved' and resolved_at is not null) = 2, r::text);
  set local role service_role; r := sync_notifications(n1, jsonb_build_array(t.d('payment_failed', k1))); reset role;
  perform t.check('13 si vuelve a corresponder, se reabre (sin duplicar) y el otro sigue resuelto',
    (r->>'reopened')::int = 1 and (r->>'created')::int = 0 and (select status from notifications where dedupe_key = k1) = 'open'
    and (select resolved_at from notifications where dedupe_key = k1) is null and (select status from notifications where dedupe_key = k2) = 'resolved', r::text);
  perform t.check('14 reabrir NO toca el estado del correo (no se reenvía)', (select email_status = 'sent' and email_attempts = 1 from notifications where dedupe_key = k1));

  -- ---- descartar ----
  set local role service_role; perform sync_notifications(n1, jsonb_build_array(t.d('payment_failed', k1), t.d('payment_confirmed', k2, 'info'))); reset role;
  select id into id1 from notifications where dedupe_key = k1; select id into id2 from notifications where dedupe_key = k2;
  perform t.as_user(n2);
  ok := dismiss_notification(id2);
  perform t.su();
  perform t.check('15 otro usuario no puede descartar un aviso ajeno', ok = false and (select status from notifications where id = id2) = 'open');
  perform t.as_user(n1);
  ok := dismiss_notification(id1);
  perform t.check('16 un aviso de estado de cuenta NO se puede descartar', ok = false and (select status from notifications where id = id1) = 'open');
  ok := dismiss_notification(id2);
  perform t.su();
  perform t.check('17 el dueño descarta un informativo', ok = true and (select status from notifications where id = id2) = 'dismissed' and (select dismissed_at from notifications where id = id2) is not null);
  set local role service_role; r := sync_notifications(n1, jsonb_build_array(t.d('payment_failed', k1), t.d('payment_confirmed', k2, 'info'))); reset role;
  perform t.check('18 un aviso descartado no reaparece al sincronizar', (select status from notifications where id = id2) = 'dismissed' and (r->>'reopened')::int = 0, r::text);
  perform t.as_user(n1); ok := dismiss_notification(id2); perform t.su();
  perform t.check('19 descartar dos veces no hace nada', ok = false);
  perform set_config('request.jwt.claim.sub', '', true);
  perform t.err('20 sin sesión no se puede descartar', format($f$select dismiss_notification(%L)$f$, id2), 'No autenticado');

  -- ---- aislamiento entre usuarios ----
  perform t.as_user(n2);
  perform t.check('21 otro usuario no ve los avisos ajenos', (select count(*) from notifications) = 0);
  perform t.su();
  perform t.as_user(adm);
  perform t.check('22 el admin ve todos', (select count(*) from notifications) = 2);
  perform t.su();
  set local role service_role; r := sync_notifications(n2, jsonb_build_array(t.d('payment_failed', k1))); reset role;
  perform t.check('23 una clave ya usada por otro usuario no se roba ni se duplica', (r->>'created')::int = 0 and (select user_id from notifications where dedupe_key = k1) = n1
    and (select count(*) from notifications where user_id = n2) = 0, r::text);
  set local role service_role; r := sync_notifications(n2, '[]'::jsonb); reset role;
  perform t.check('24 sincronizar a un usuario nunca resuelve avisos de otro', (select status from notifications where dedupe_key = k1) = 'open', r::text);

  -- ---- borrado del usuario ----
  set local role service_role; perform sync_notifications(n4, jsonb_build_array(t.d('grace_period','g:n4:1'))); reset role;
  perform t.check('25 el usuario n4 tiene su aviso', (select count(*) from notifications where user_id = n4) = 1);
  delete from profiles where id = n4; delete from auth.users where id = n4;
  perform t.check('26 al borrar el usuario se borran sus avisos', (select count(*) from notifications where user_id = n4) = 0);
end $$;

\echo ===== RESULTADOS =====
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '   -> ' || coalesce(detail,'') end from t.results order by n;
select 'TOTAL: ' || count(*) || '  PASS: ' || count(*) filter (where ok) || '  FAIL: ' || count(*) filter (where not ok) from t.results;

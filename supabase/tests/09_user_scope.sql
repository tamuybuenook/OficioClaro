-- Etapa 2: aislamiento de datos del usuario (lo que alimenta Inicio, Mi suscripción y Mi perfil). DB de PRUEBAS (run_user_scope.sh).
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
-- Una escritura "sin efecto": o la base la deniega (permission denied / RLS) o afecta 0 filas.
create or replace function t.no_effect(p_name text, p_sql text) returns void language plpgsql as $$
declare n int;
begin
  begin execute p_sql; get diagnostics n = row_count; perform t.check(p_name, n = 0, 'filas afectadas: ' || n);
  exception when others then perform t.check(p_name, sqlerrm ilike '%permission denied%' or sqlerrm ilike '%row-level security%', sqlerrm); end;
end $$;
create or replace function t.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end $$;
create or replace function t.su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000d1','a@t.com',now()), ('00000000-0000-0000-0000-0000000000d2','b@t.com',now()), ('00000000-0000-0000-0000-0000000000d3','adm@t.com',now());
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000d3';

do $$
declare
  ua uuid := '00000000-0000-0000-0000-0000000000d1'; ub uuid := '00000000-0000-0000-0000-0000000000d2'; adm uuid := '00000000-0000-0000-0000-0000000000d3';
  sa uuid; sb uuid; sadm uuid; pm uuid; pa uuid; pb uuid; ea date; n int; n2 int;
begin
  select id into pm from plans where name = 'Profesional';
  select id into sa from subscriptions where user_id = ua; select id into sb from subscriptions where user_id = ub; select id into sadm from subscriptions where user_id = adm;
  update subscriptions set plan_id = pm, status = 'expired_x' where false; -- (sin efecto: solo documenta que no se toca nada)
  update subscriptions set plan_id = pm, status = 'past_due', end_date = current_date - 3 where id in (sa, sb);
  select end_date into ea from subscriptions where id = sa;
  insert into payments(subscription_id, provider, amount, reference, status) values (sa, 'transfer', 9000, 'A-1', 'rejected') returning id into pa;
  insert into payments(subscription_id, provider, amount, reference, status) values (sa, 'transfer', 9000, 'A-2', 'pending');
  insert into payments(subscription_id, provider, amount, reference, status) values (sb, 'transfer', 7000, 'B-1', 'pending') returning id into pb;
  insert into bank_reconciliations(payment_id, reconciled_by, status, notes) values (pa, adm, 'rejected', 'motivo interno');

  -- U1: solo lo suyo (misma consulta que usa el panel: pagos de SUS suscripciones)
  perform t.as_user(ua);
  select count(*) into n from payments p join subscriptions s on s.id = p.subscription_id where s.user_id = ua;
  select count(*) into n2 from payments;
  perform t.check('S1 el usuario ve sus propios pagos', n = 2 and n2 = 2);
  perform t.check('S2 no ve pagos ajenos', not exists (select 1 from payments where reference = 'B-1'));
  perform t.check('S3 no ve la suscripción de otro', (select count(*) from subscriptions) = 1 and not exists (select 1 from subscriptions where user_id = ub));
  perform t.check('S4 no ve el motivo interno de un rechazo (bank_reconciliations es solo de admin)', (select count(*) from bank_reconciliations) = 0);
  perform t.check('S5 no ve el perfil de otro', not exists (select 1 from profiles where id = ub));
  -- no puede modificar su estado de cuenta ni sus pagos desde el navegador
  perform t.no_effect('S6 no puede activarse la suscripción por su cuenta', format($f$update subscriptions set status = 'active', end_date = current_date + 365 where id = %L$f$, sa));
  perform t.no_effect('S7 no puede aprobar su propio pago', $f$update payments set status = 'reconciled' where reference = 'A-2'$f$);
  perform t.no_effect('S8 ni borrar pagos', $f$delete from payments where reference = 'A-2'$f$);
  perform t.no_effect('S8b ni modificar el importe de un pago', $f$update payments set amount = 1 where reference = 'A-2'$f$);
  perform t.su();
  perform t.check('S9 nada cambió en la suscripción ni en los pagos', (select status from subscriptions where id = sa) = 'past_due' and (select end_date from subscriptions where id = sa) = ea and (select status from payments where reference = 'A-2') = 'pending' and exists (select 1 from payments where reference = 'A-2'));

  -- U2 no ve lo de U1
  perform t.as_user(ub);
  perform t.check('S10 el otro usuario solo ve lo suyo', (select count(*) from payments) = 1 and (select reference from payments) = 'B-1');
  perform t.su();

  -- El administrador, con la política actual, ve TODOS los pagos: por eso el panel de usuario filtra por dueño.
  perform t.as_user(adm);
  select count(*) into n from payments;
  select count(*) into n2 from payments p join subscriptions s on s.id = p.subscription_id where s.user_id = adm;
  perform t.check('S11 un admin ve todos los pagos por RLS (3) y la consulta del panel de usuario, filtrada por dueño, devuelve solo los suyos (0)', n = 3 and n2 = 0, n || '/' || n2);
  perform t.su();
end $$;

\echo ===== RESULTADOS =====
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '   -> ' || coalesce(detail,'') end from t.results order by n;
select 'TOTAL: ' || count(*) || '  PASS: ' || count(*) filter (where ok) || '  FAIL: ' || count(*) filter (where not ok) from t.results;

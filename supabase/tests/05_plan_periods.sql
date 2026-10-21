-- Pruebas SQL de la migración 0032 (planes de 3 y 6 meses). DB de PRUEBAS aislada (run_plan_periods.sh).
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

insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000b1','q@t.com',now()),   -- trimestral
 ('00000000-0000-0000-0000-0000000000b2','s@t.com',now()),   -- semestral
 ('00000000-0000-0000-0000-0000000000b3','y@t.com',now()),   -- anual
 ('00000000-0000-0000-0000-0000000000b4','m@t.com',now()),   -- mensual
 ('00000000-0000-0000-0000-0000000000b5','fm@t.com',now()),  -- fin de mes
 ('00000000-0000-0000-0000-0000000000b6','tr@t.com',now()),  -- transferencia trimestral
 ('00000000-0000-0000-0000-0000000000b7','h@t.com',now()),   -- retenido semestral
 ('00000000-0000-0000-0000-0000000000b8','adm@t.com',now());
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b8';

do $$
declare
  b1 uuid := '00000000-0000-0000-0000-0000000000b1'; b2 uuid := '00000000-0000-0000-0000-0000000000b2';
  b3 uuid := '00000000-0000-0000-0000-0000000000b3'; b4 uuid := '00000000-0000-0000-0000-0000000000b4';
  b5 uuid := '00000000-0000-0000-0000-0000000000b5'; b6 uuid := '00000000-0000-0000-0000-0000000000b6';
  b7 uuid := '00000000-0000-0000-0000-0000000000b7'; adm uuid := '00000000-0000-0000-0000-0000000000b8';
  pq uuid; ps uuid; py uuid; pm uuid; s uuid; i uuid; r jsonb; e0 date; e1 date; n int;
begin
  -- ---- CHECK ampliado ----
  insert into plans(name, price, billing_period, is_active) values ('Trimestral', 24000, 'quarterly', true) returning id into pq;
  insert into plans(name, price, billing_period, is_active) values ('Semestral', 45000, 'semiannual', true) returning id into ps;
  insert into plans(name, price, billing_period, is_active) values ('Anual', 90000, 'yearly', true) returning id into py;
  select id into pm from plans where name = 'Profesional';
  perform t.check('1 el CHECK acepta quarterly y semiannual', pq is not null and ps is not null);
  perform t.err('2 el CHECK rechaza períodos inventados', $f$insert into plans(name, price, billing_period) values ('X', 1, 'weekly')$f$, 'plans_billing_period_check');
  perform t.err('3 el CHECK rechaza bimonthly', $f$insert into plans(name, price, billing_period) values ('Y', 1, 'bimonthly')$f$, 'plans_billing_period_check');
  perform t.check('4 los planes existentes (monthly) siguen válidos', (select billing_period from plans where id = pm) = 'monthly');

  -- ---- plan_period_months ----
  perform t.check('5 meses por período 1/3/6/12', plan_period_months('monthly') = 1 and plan_period_months('quarterly') = 3 and plan_period_months('semiannual') = 6 and plan_period_months('yearly') = 12);
  perform t.err('6 período desconocido falla (no asume mensual)', $f$select plan_period_months('weekly')$f$, 'mp:unsupported_plan_period');
  perform t.err('7 null también falla', $f$select plan_period_months(null)$f$, 'mp:unsupported_plan_period');
  perform t.as_user(b1);
  perform t.err('8 un usuario no ejecuta plan_period_months directamente', $f$select plan_period_months('monthly')$f$, 'permission denied');
  perform t.err('9 sigue sin poder ejecutar record_mp_payment (permisos intactos)', format($f$select record_mp_payment(null,%L,'x','approved',null,9000,'ARS')$f$, (select id from subscriptions where user_id = b1)), 'permission denied');
  perform t.su();

  -- ---- pago aprobado de Mercado Pago: extiende según el plan ----
  perform t.check('10 las suscripciones nacen con prueba', (select count(*) from subscriptions where user_id in (b1,b2,b3,b4)) = 4);
  -- (usuario, plan, precio, meses esperados, id de pago, id externo)
  for n in 1..4 loop
    declare
      uid uuid := case n when 1 then b1 when 2 then b2 when 3 then b3 else b4 end;
      pid uuid := case n when 1 then pq when 2 then ps when 3 then py else pm end;
      price numeric := case n when 1 then 24000 when 2 then 45000 when 3 then 90000 else 9000 end;
      months int := case n when 1 then 3 when 2 then 6 when 3 then 12 else 1 end;
      pay uuid := ('00000000-0000-0000-0000-00000000a00' || n)::uuid;
    begin
      select id into s from subscriptions where user_id = uid;
      insert into payments(id, subscription_id, provider, amount, reference, status, plan_id) values (pay, s, 'mercadopago', price, 'oc-p' || n, 'pending', pid);
      select end_date into e0 from subscriptions where id = s;
      set local role service_role;
      r := record_mp_payment(pay, null, 'MP-P' || n, 'approved', 'accredited', price, 'ARS');
      reset role;
      select end_date into e1 from subscriptions where id = s;
      perform t.check('11.' || n || ' pago de ' || months || ' mes(es): activa, cambia de plan y extiende exactamente ' || months || ' mes(es)',
        r->>'outcome' = 'processed' and (select status from subscriptions where id = s) = 'active' and (select plan_id from subscriptions where id = s) = pid
        and e1 = (greatest(e0, ar_today()) + make_interval(months => months))::date, r::text || ' ' || e0 || '->' || e1);
    end;
  end loop;
  select id into s from subscriptions where user_id = b2;
  select end_date into e0 from subscriptions where id = s;
  set local role service_role;
  r := record_mp_payment('00000000-0000-0000-0000-00000000a002', null, 'MP-P2', 'approved', 'accredited', 45000, 'ARS');
  reset role;
  perform t.check('12 notificación repetida del pago semestral: duplicate y no extiende de nuevo', r->>'outcome' = 'duplicate' and (select end_date from subscriptions where id = s) = e0, r::text);

  -- ---- fin de mes: el día se ajusta al último del mes destino ----
  select id into s from subscriptions where user_id = b5;
  update subscriptions set end_date = '2099-01-31', status = 'active', plan_id = pq where id = s;
  insert into payments(id, subscription_id, provider, amount, reference, status, plan_id) values ('00000000-0000-0000-0000-00000000a005', s, 'mercadopago', 24000, 'oc-fm', 'pending', pq);
  set local role service_role; r := record_mp_payment('00000000-0000-0000-0000-00000000a005', null, 'MP-FM', 'approved', 'accredited', 24000, 'ARS'); reset role;
  perform t.check('13 31/01 + 3 meses = 30/04', (select end_date from subscriptions where id = s) = '2099-04-30', (select end_date::text from subscriptions where id = s));

  -- ---- conciliación manual de una transferencia (plan trimestral) ----
  select id into s from subscriptions where user_id = b6;
  update subscriptions set plan_id = pq, end_date = current_date + 10, status = 'active' where id = s;
  insert into payments(id, subscription_id, provider, amount, reference, status, plan_id) values ('00000000-0000-0000-0000-00000000e0a1', s, 'transfer', 24000, 'tr-q', 'pending', pq);
  select end_date into e0 from subscriptions where id = s;
  perform t.as_user(adm);
  r := reconcile_transfer_payment('00000000-0000-0000-0000-00000000e0a1', 'reconciled', 'ok');
  perform t.su();
  perform t.check('14 transferencia trimestral conciliada: extiende 3 meses desde el vencimiento vigente',
    (select end_date from subscriptions where id = s) = (greatest(e0, ar_today()) + interval '3 months')::date and (r->>'end_date')::date = (select end_date from subscriptions where id = s), r::text);

  -- ---- cobro retenido (cuenta suspendida) aplicado por el admin: plan semestral ----
  select id into s from subscriptions where user_id = b7;
  update subscriptions set plan_id = ps, end_date = current_date + 5, status = 'suspended' where id = s;
  insert into payments(id, subscription_id, provider, amount, reference, status, plan_id) values ('00000000-0000-0000-0000-00000000a007', s, 'mercadopago', 45000, 'oc-h', 'pending', ps);
  set local role service_role; r := record_mp_payment('00000000-0000-0000-0000-00000000a007', null, 'MP-H', 'approved', null, 45000, 'ARS'); reset role;
  perform t.check('15 cobro sobre cuenta suspendida: retenido, sin extender', r->>'outcome' = 'held' and (select end_date from subscriptions where id = s) = current_date + 5, r::text);
  select end_date into e0 from subscriptions where id = s;
  perform t.as_user(adm);
  r := resolve_held_mp_payment('00000000-0000-0000-0000-00000000a007', 'apply', 'ok');
  perform t.su();
  perform t.check('16 el admin aplica el cobro retenido: extiende 6 meses y la cuenta sigue suspendida',
    (select end_date from subscriptions where id = s) = (greatest(e0, ar_today()) + interval '6 months')::date and (select status from subscriptions where id = s) = 'suspended', r::text);
end $$;

\echo ===== RESULTADOS =====
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '   -> ' || coalesce(detail,'') end from t.results order by n;
select 'TOTAL: ' || count(*) || '  PASS: ' || count(*) filter (where ok) || '  FAIL: ' || count(*) filter (where not ok) from t.results;

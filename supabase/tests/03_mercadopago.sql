-- Pruebas SQL de la migración 0023. DB de PRUEBAS aislada (run_mercadopago.sh).
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
 ('00000000-0000-0000-0000-0000000000a1','u1@t.com'),
 ('00000000-0000-0000-0000-0000000000a2','u2@t.com');

do $$
declare
  u1 uuid := '00000000-0000-0000-0000-0000000000a1';
  u2 uuid := '00000000-0000-0000-0000-0000000000a2';
  s1 uuid; s2 uuid; pro uuid; basico uuid;
  i1 uuid; i2 uuid; r jsonb; e0 date; e1 date; n int; pid uuid;
begin
  select id into s1 from subscriptions where user_id = u1;
  select id into s2 from subscriptions where user_id = u2;
  select id into pro from plans where name = 'Profesional';
  select id into basico from plans where name = 'Básico';
  perform t.check('0 el trigger crea la prueba inicial', s1 is not null and (select status from subscriptions where id = s1) = 'trial');

  -- ---- Seguridad (1.a / 1.b) ----
  perform t.as_user(u1);
  perform t.err('1 usuario no puede insertar un pago de MP aprobado', format($f$insert into payments(subscription_id,provider,amount,status) values (%L,'mercadopago',9000,'reconciled')$f$, s1), 'row-level security');
  perform t.err('2 usuario no puede insertar transfer ya conciliada', format($f$insert into payments(subscription_id,provider,amount,status) values (%L,'transfer',9000,'reconciled')$f$, s1), 'row-level security');
  perform t.err('3 usuario no puede fijar external_id/plan_id', format($f$insert into payments(subscription_id,provider,amount,status,plan_id) values (%L,'transfer',9000,'pending',%L)$f$, s1, pro), 'row-level security');
  perform t.err('4 usuario no puede pagar sobre suscripción ajena', format($f$insert into payments(subscription_id,provider,amount,status) values (%L,'transfer',9000,'pending')$f$, s2), 'row-level security');
  insert into payments(subscription_id,provider,amount,reference,status) values (s1,'transfer',9000,'op-1','pending');
  perform t.check('5 sí puede informar una transferencia pendiente propia', (select count(*) from payments where subscription_id = s1) = 1);
  perform t.err('6 usuario no puede crearse otra prueba', format($f$insert into subscriptions(user_id,plan_id,status) values (%L,%L,'trial')$f$, u1, pro), 'row-level security');
  perform t.err('7 usuario no puede ejecutar record_mp_payment', format($f$select record_mp_payment(null,%L,'x','approved',null,9000,'ARS')$f$, s1), 'permission denied');
  update subscriptions set status = 'active', end_date = '2099-01-01' where id = s1;
  perform t.su();
  perform t.check('8 usuario no puede activarse su propia suscripción', (select status from subscriptions where id = s1) = 'trial');

  -- ---- Pago manual aprobado ----
  insert into payments(id,subscription_id,provider,amount,reference,status,plan_id) values
    ('00000000-0000-0000-0000-00000000f001', s1, 'mercadopago', 9000, 'oc-test', 'pending', pro);
  i1 := '00000000-0000-0000-0000-00000000f001';
  select end_date into e0 from subscriptions where id = s1;
  perform t.su();
  set local role service_role;
  perform t.err('9 monto manipulado', format($f$select record_mp_payment(%L,null,'MP-1','approved',null,1,'ARS')$f$, i1), 'mp:amount_mismatch');
  perform t.err('10 moneda distinta', format($f$select record_mp_payment(%L,null,'MP-1','approved',null,9000,'USD')$f$, i1), 'mp:currency_mismatch');
  perform t.err('11 intención inexistente', $f$select record_mp_payment('00000000-0000-0000-0000-0000deadbeef',null,'MP-9','approved',null,9000,'ARS')$f$, 'mp:intent_not_found');
  reset role;
  perform t.check('12 los rechazos no modificaron nada', (select status from subscriptions where id = s1) = 'trial' and (select applied_at is null and external_id is null from payments where id = i1));

  set local role service_role;
  r := record_mp_payment(i1, null, 'MP-1', 'pending', 'pending_waiting_payment', 9000, 'ARS');
  reset role;
  perform t.check('13 pendiente no activa', (select status from subscriptions where id = s1) = 'trial' and (select status from payments where id = i1) = 'pending');

  set local role service_role;
  r := record_mp_payment(i1, null, 'MP-1', 'approved', 'accredited', 9000, 'ARS');
  reset role;
  select end_date into e1 from subscriptions where id = s1;
  perform t.check('14 aprobado activa, cambia al plan pagado y extiende', r->>'outcome' = 'processed' and (select status from subscriptions where id = s1) = 'active'
    and (select plan_id from subscriptions where id = s1) = pro and e1 = (greatest(e0, ar_today()) + interval '1 month')::date, r::text);

  set local role service_role;
  r := record_mp_payment(i1, null, 'MP-1', 'approved', 'accredited', 9000, 'ARS');
  reset role;
  perform t.check('15 notificación duplicada: no extiende de nuevo', r->>'outcome' = 'duplicate' and (select end_date from subscriptions where id = s1) = e1, r::text);

  set local role service_role;
  r := record_mp_payment(i1, null, 'MP-1', 'in_process', null, 9000, 'ARS');
  reset role;
  perform t.check('16 notificación tardía "pendiente" no degrada un pago aprobado', r->>'outcome' = 'ignored' and (select status from payments where id = i1) = 'reconciled', r::text);

  set local role service_role;
  r := record_mp_payment(i1, null, 'MP-1', 'rejected', null, 9000, 'ARS');
  reset role;
  perform t.check('17 "rechazado" tardío tampoco', (select status from payments where id = i1) = 'reconciled' and (select status from subscriptions where id = s1) = 'active');

  -- ---- Reintento: rechazado y luego aprobado con otro id de pago sobre la misma preferencia ----
  insert into payments(id,subscription_id,provider,amount,reference,status,plan_id) values
    ('00000000-0000-0000-0000-00000000f002', s2, 'mercadopago', 5000, 'oc-test2', 'pending', basico);
  i2 := '00000000-0000-0000-0000-00000000f002';
  select end_date into e0 from subscriptions where id = s2;
  set local role service_role;
  r := record_mp_payment(i2, null, 'MP-2A', 'rejected', 'cc_rejected_other_reason', 5000, 'ARS');
  reset role;
  perform t.check('18 rechazado no activa', (select status from subscriptions where id = s2) = 'trial');
  set local role service_role;
  r := record_mp_payment(i2, null, 'MP-2B', 'approved', 'accredited', 5000, 'ARS');
  reset role;
  select count(*) into n from payments where subscription_id = s2 and provider = 'mercadopago';
  perform t.check('19 reintento aprobado crea fila nueva y activa', n = 2 and (select status from subscriptions where id = s2) = 'active'
    and (select plan_id from subscriptions where id = s2) = basico, r::text);

  -- ---- Un id de pago no puede reasignarse a otra operación/usuario ----
  insert into payments(id,subscription_id,provider,amount,reference,status,plan_id) values
    ('00000000-0000-0000-0000-00000000f003', s1, 'mercadopago', 9000, 'oc-test3', 'pending', pro);
  set local role service_role;
  perform t.err('20 pago ya usado en otra suscripción', $f$select record_mp_payment('00000000-0000-0000-0000-00000000f003',null,'MP-2B','approved',null,5000,'ARS')$f$, 'mp:reference_mismatch');
  reset role;

  -- ---- Reembolso ----
  set local role service_role;
  r := record_mp_payment(i1, null, 'MP-1', 'refunded', null, 9000, 'ARS');
  reset role;
  perform t.check('21 reembolso: pago refunded, acceso no se revoca solo, queda auditado',
    (select status from payments where id = i1) = 'refunded' and (select status from subscriptions where id = s1) = 'active'
    and exists (select 1 from audit_logs where entity = 'payments' and entity_id = i1 and action = 'mp_refunded'));

  -- ---- Renovación automática ----
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s1, pro, 9000, 'PRE-1', 'authorized');
  select end_date into e0 from subscriptions where id = s1;
  set local role service_role;
  perform t.err('22 renovación con monto distinto al autorizado', format($f$select record_mp_payment(null,%L,'MP-R1','approved',null,12000,'ARS','PRE-1')$f$, s1), 'mp:amount_mismatch');
  perform t.err('23 renovación de suscripción sin preapproval', format($f$select record_mp_payment(null,%L,'MP-R0','approved',null,9000,'ARS')$f$, s2), 'mp:no_preapproval');
  r := record_mp_payment(null, s1, 'MP-R1', 'approved', null, 9000, 'ARS', 'PRE-1');
  reset role;
  perform t.check('24 renovación aprobada extiende desde el vencimiento', r->>'outcome' = 'processed' and (select end_date from subscriptions where id = s1) = (greatest(e0, ar_today()) + interval '1 month')::date, r::text);
  e1 := (select end_date from subscriptions where id = s1);
  set local role service_role;
  r := record_mp_payment(null, s1, 'MP-R1', 'approved', null, 9000, 'ARS', 'PRE-1');
  r := record_mp_payment(null, s1, 'MP-R2', 'rejected', 'cc_rejected_insufficient_amount', 9000, 'ARS', 'PRE-1');
  reset role;
  perform t.check('25 renovación fallida: past_due, conserva end_date, sin duplicar el pago aprobado',
    (select status from subscriptions where id = s1) = 'past_due' and (select end_date from subscriptions where id = s1) = e1
    and (select count(*) from payments where external_id = 'MP-R1') = 1);
  perform t.err('26 un id de MP único por fila', format($f$insert into payments(subscription_id,provider,amount,external_id) values (%L,'mercadopago',9000,'MP-R1')$f$, s1), 'duplicate key');

  -- ---- Otro usuario no ve pagos ajenos ----
  perform t.as_user(u2);
  perform t.check('27 usuario no ve pagos ajenos', (select count(*) from payments where subscription_id = s1) = 0);
  perform t.check('28 usuario no ve el log de webhooks', (select count(*) from mp_webhook_events) = 0);
  perform t.su();
end $$;


-- ================= 0024: endurecimiento =================
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a3','Foo.Bar+x@gmail.com'),
 ('00000000-0000-0000-0000-0000000000a4','foobar@googlemail.com'),
 ('00000000-0000-0000-0000-0000000000a5','otro+tag@empresa.com'),
 ('00000000-0000-0000-0000-0000000000a6','OTRO@empresa.com'),
 ('00000000-0000-0000-0000-0000000000a7','sup@t.com');
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-0000000000a1';
  u3 uuid := '00000000-0000-0000-0000-0000000000a3'; u4 uuid := '00000000-0000-0000-0000-0000000000a4';
  u5 uuid := '00000000-0000-0000-0000-0000000000a5'; u6 uuid := '00000000-0000-0000-0000-0000000000a6';
  u7 uuid := '00000000-0000-0000-0000-0000000000a7';
  s7 uuid; pro uuid; basico uuid; medium uuid; t1 uuid; t2 uuid; t3 uuid; i7 uuid; ok1 boolean; ok2 boolean; r jsonb; n int;
begin
  select id into pro from plans where name='Profesional'; select id into basico from plans where name='Básico'; select id into medium from plans where name='Medium';
  select id into t1 from trades order by name limit 1; select id into t2 from trades order by name offset 1 limit 1; select id into t3 from trades order by name offset 2 limit 1;

  -- ---- prueba única por persona ----
  perform t.check('30 normalize_email: puntos, +tag y googlemail', normalize_email('Foo.Bar+x@gmail.com') = 'foobar@gmail.com' and normalize_email('foobar@googlemail.com') = 'foobar@gmail.com' and normalize_email('A+b@x.com') = 'a@x.com' and normalize_email('nada') is null);
  perform t.check('31 primera cuenta: prueba', (select status from subscriptions where user_id = u3) = 'trial');
  perform t.check('32 mismo email con variantes: SIN segunda prueba', (select status from subscriptions where user_id = u4) = 'past_due' and (select end_date from subscriptions where user_id = u4) < current_date);
  perform t.check('33 +tag en dominio propio tampoco reinicia', (select status from subscriptions where user_id = u5) = 'trial' and (select status from subscriptions where user_id = u6) = 'past_due');
  delete from auth.users where id = u3; delete from profiles where id = u3;
  insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a8','foo.bar@gmail.com');
  perform t.check('34 borrar la cuenta y recrearla no libera la prueba', (select status from subscriptions where user_id = '00000000-0000-0000-0000-0000000000a8') = 'past_due');
  perform t.check('35 los usuarios previos quedaron registrados (backfill/claims)', exists (select 1 from trial_claims where email_norm = 'u1@t.com'));
  perform t.as_user(u1);
  perform t.err('36 usuario no accede a trial_claims', 'select 1 from trial_claims', 'permission denied');
  perform t.su();

  -- ---- límite de oficios en la base ----
  select id into s7 from subscriptions where user_id = u7;
  update subscriptions set plan_id = basico, status = 'active', end_date = current_date + 10 where id = s7;
  perform t.as_user(u7);
  insert into user_trades(user_id, trade_id) values (u7, t1);
  perform t.err('37 Básico: segundo oficio directo por API bloqueado', format($f$insert into user_trades(user_id,trade_id) values (%L,%L)$f$, u7, t2), 'no permite agregar');
  perform t.su();
  update subscriptions set plan_id = medium where id = s7;
  perform t.as_user(u7);
  insert into user_trades(user_id, trade_id) values (u7, t2), (u7, t3);
  perform t.su();
  perform t.check('38 Medium: hasta 3 en un solo insert múltiple', (select count(*) from user_trades where user_id = u7) = 3);
  perform t.as_user(u7);
  perform t.err('39 inserción de oficio ajeno', format($f$insert into user_trades(user_id,trade_id) values (%L,%L)$f$, u1, t1), 'row-level security');
  perform t.su();
  update subscriptions set plan_id = basico where id = s7;  -- baja de plan con 3 oficios
  perform t.as_user(u7);
  perform t.check('40 bajar de plan conserva y permite consultar los 3 oficios', (select count(*) from user_trades where user_id = u7) = 3);
  perform t.su();
  delete from user_trades where user_id = u7;
  update subscriptions set end_date = ar_today() - 1 where id = s7;
  perform t.as_user(u7);
  perform t.err('41 suscripción vencida: sin altas', format($f$insert into user_trades(user_id,trade_id) values (%L,%L)$f$, u7, t1), 'no permite agregar');
  perform t.su();
  update subscriptions set plan_id = pro, end_date = current_date + 5 where id = s7;
  perform t.as_user(u7);
  insert into user_trades(user_id, trade_id) values (u7, t1), (u7, t2), (u7, t3);
  perform t.su();
  perform t.check('42 Profesional sin límite', (select count(*) from user_trades where user_id = u7) = 3);
  update subscriptions set status = 'suspended' where id = s7;
  perform t.check('43 user_trade_limit: suspendida = 0', user_trade_limit(u7) = 0);

  -- ---- pago aprobado no reactiva una cuenta suspendida ----
  insert into payments(id,subscription_id,provider,amount,reference,status,plan_id) values
    ('00000000-0000-0000-0000-00000000f0a7', s7, 'mercadopago', 9000, 'oc-s', 'pending', pro);
  set local role service_role;
  r := record_mp_payment('00000000-0000-0000-0000-00000000f0a7', null, 'MP-S1', 'approved', null, 9000, 'ARS');
  reset role;
  perform t.check('44 pago sobre cuenta suspendida: NO se acredita; queda retenido para revisión (sin cambiar vencimiento ni acceso)',
    r->>'outcome' = 'held' and (select status from subscriptions where id = s7) = 'suspended'
    and (select status from payments where id = '00000000-0000-0000-0000-00000000f0a7') = 'reconciled'
    and (select applied_at from payments where id = '00000000-0000-0000-0000-00000000f0a7') is null
    and (select review_reason from payments where id = '00000000-0000-0000-0000-00000000f0a7') = 'subscription_suspended'
    and exists (select 1 from audit_logs where entity_id = '00000000-0000-0000-0000-00000000f0a7' and action = 'mp_incident_payment_held'), r::text);

  -- ---- rate limit ----
  set local role service_role;
  select rate_limit_hit('k1', 3, 600) into ok1; perform rate_limit_hit('k1', 3, 600); perform rate_limit_hit('k1', 3, 600);
  select rate_limit_hit('k1', 3, 600) into ok2;
  reset role;
  perform t.check('45 rate_limit_hit: permite hasta el máximo y luego bloquea', ok1 and not ok2);
  set local role service_role; select rate_limit_hit('k2', 3, 600) into ok1; reset role;
  perform t.check('46 claves independientes', ok1);
  perform t.as_user(u1);
  perform t.err('47 usuario no puede llamar rate_limit_hit', $f$select rate_limit_hit('k1', 1000, 60)$f$, 'permission denied');
  perform t.su();
end $$;


-- ================= 0025 =================
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000c1', null, now()),
 ('00000000-0000-0000-0000-0000000000c2', 'sin-arroba', now()),
 ('00000000-0000-0000-0000-0000000000c3', 'a@b', now()),
 ('00000000-0000-0000-0000-0000000000c4', 'Pend.Ing+1@gmail.com', null),
 ('00000000-0000-0000-0000-0000000000c5', 'squat@empresa.com', null),
 ('00000000-0000-0000-0000-0000000000c6', 'squat@empresa.com', now()),
 ('00000000-0000-0000-0000-0000000000c7', 'adm@t.com', now()),
 ('00000000-0000-0000-0000-0000000000c8', 'tx@t.com', now());
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c7';
do $$
declare
  c1 uuid := '00000000-0000-0000-0000-0000000000c1'; c2 uuid := '00000000-0000-0000-0000-0000000000c2'; c3 uuid := '00000000-0000-0000-0000-0000000000c3';
  c4 uuid := '00000000-0000-0000-0000-0000000000c4'; c5 uuid := '00000000-0000-0000-0000-0000000000c5'; c6 uuid := '00000000-0000-0000-0000-0000000000c6';
  adm uuid := '00000000-0000-0000-0000-0000000000c7'; c8 uuid := '00000000-0000-0000-0000-0000000000c8';
  u1 uuid := '00000000-0000-0000-0000-0000000000a1';
  s uuid; s8 uuid; pro uuid; v_td int; n int; r jsonb; e0 date; pid uuid; pid2 uuid; ok boolean;
begin
  select id, plans.trial_days into pro, v_td from plans where name = 'Profesional';
  select id into s8 from subscriptions where user_id = c8;

  -- ---- prueba: email inexistente / inválido / sin verificar ----
  perform t.check('50 email nulo: sin prueba automática', (select status from subscriptions where user_id = c1) = 'past_due' and not (select trial_pending from subscriptions where user_id = c1));
  perform t.check('51 email inválido: sin prueba', (select status from subscriptions where user_id = c2) = 'past_due' and (select status from subscriptions where user_id = c3) = 'past_due'
    and not (select trial_pending from subscriptions where user_id = c2) and not (select trial_pending from subscriptions where user_id = c3));
  perform t.check('52 sin prueba = sin acceso', not subscription_has_access('past_due', (select end_date from subscriptions where user_id = c1)));
  perform t.check('53 email válido sin verificar: queda pendiente, sin prueba ni reclamo', (select status from subscriptions where user_id = c4) = 'past_due'
    and (select trial_pending from subscriptions where user_id = c4) and not exists (select 1 from trial_claims where email_norm = 'pending@gmail.com'));
  update auth.users set email_confirmed_at = now() where id = c4;
  perform t.check('54 al verificar el email se concede la prueba con los días del plan', (select status from subscriptions where user_id = c4) = 'trial'
    and (select end_date from subscriptions where user_id = c4) = ar_today() + v_td and not (select trial_pending from subscriptions where user_id = c4)
    and exists (select 1 from trial_claims where email_norm = 'pending@gmail.com'));
  perform t.check('55 quien no verificó no bloquea a quien sí (no hay reclamo sin verificación)', (select status from subscriptions where user_id = c6) = 'trial');
  update auth.users set email_confirmed_at = now() where id = c5;
  perform t.check('56 verificar un email ya usado: sin segunda prueba', (select status from subscriptions where user_id = c5) = 'past_due' and not (select trial_pending from subscriptions where user_id = c5));
  insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000c9', 'pend.ing@googlemail.com', now());
  perform t.check('57 alias de Gmail del email ya reclamado: sin prueba', (select status from subscriptions where user_id = '00000000-0000-0000-0000-0000000000c9') = 'past_due');
  delete from profiles where id = c6; delete from auth.users where id = c6;
  insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000d1', 'squat@empresa.com', now());
  perform t.check('58 el historial de reclamos sobrevive al borrado de la cuenta y la recreada no obtiene prueba', exists (select 1 from trial_claims where email_norm = 'squat@empresa.com')
    and (select status from subscriptions where user_id = '00000000-0000-0000-0000-0000000000d1') = 'past_due');
  perform t.check('59 normalize_email rechaza inválidos', normalize_email(null) is null and normalize_email('a@b') is null and normalize_email('a b@c.com') is null and normalize_email('x@@y.com') is null and normalize_email('Ok@Y.com') = 'ok@y.com');

  -- ---- ledger de autorizaciones ----
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s8, pro, 9000, 'PRE-A', 'pending');
  perform t.err('60 una sola autorización abierta por suscripción', format($f$insert into mp_preapprovals(subscription_id,plan_id,amount,status) values (%L,%L,9000,'creating')$f$, s8, pro), 'mp_preapprovals_one_open_uidx');
  perform t.check('61 el espejo refleja la autorización vigente', (select mp_preapproval_id||'/'||mp_status from subscriptions where id = s8) = 'PRE-A/pending');
  update mp_preapprovals set status = 'cancelling', cancel_attempts = 1, last_error = 'timeout' where preapproval_id = 'PRE-A';
  perform t.err('62 con una cancelación sin confirmar no se abre otra', format($f$insert into mp_preapprovals(subscription_id,plan_id,amount,status) values (%L,%L,9000,'creating')$f$, s8, pro), 'mp_preapprovals_one_open_uidx');
  update mp_preapprovals set status = 'cancelled', closed_at = now() where preapproval_id = 'PRE-A';
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s8, pro, 9000, 'PRE-B', 'authorized');
  perform t.check('63 tras confirmar la cancelación se puede abrir otra; ambas quedan trazadas', (select count(*) from mp_preapprovals where subscription_id = s8) = 2 and (select mp_preapproval_id from subscriptions where id = s8) = 'PRE-B');
  update subscriptions set status = 'active', end_date = ar_today() + 10 where id = s8;
  -- cobro de la autorización reemplazada (PRE-A): dinero real, se acredita y queda como incidencia
  set local role service_role;
  r := record_mp_payment(null, s8, 'MP-LATE', 'approved', null, 9000, 'ARS', 'PRE-A');
  reset role;
  perform t.check('64 cobro de una autorización reemplazada: se acredita y queda incidencia auditada', r->>'outcome' = 'processed'
    and exists (select 1 from audit_logs where action = 'mp_incident_charge_on_replaced' and new_value->>'external_id' = 'MP-LATE'));
  set local role service_role;
  r := record_mp_payment(null, s8, 'MP-LATE2', 'rejected', null, 9000, 'ARS', 'PRE-A');
  reset role;
  perform t.check('65 rechazo de una autorización cerrada no pasa la suscripción a past_due', (select status from subscriptions where id = s8) = 'active');
  set local role service_role;
  perform t.err('66 renovación con preapproval de otra suscripción', format($f$select record_mp_payment(null,%L,'MP-X','approved',null,9000,'ARS','PRE-B')$f$, u1), 'mp:no_preapproval');
  reset role;
  update mp_preapprovals set status = 'cancelled' where preapproval_id = 'PRE-B';
  perform t.check('67 cancelar la autorización vigente: sin renovación, conserva acceso hasta end_date', (select status from subscriptions where id = s8) = 'cancelled' and (select mp_status from subscriptions where id = s8) = 'cancelled' and (select end_date from subscriptions where id = s8) > ar_today());
  perform t.as_user(c8);
  perform t.check('68 el usuario no ve el ledger', (select count(*) from mp_preapprovals) = 0);
  perform t.err('69 el usuario no puede escribir el ledger', format($f$insert into mp_preapprovals(subscription_id,plan_id,amount) values (%L,%L,1)$f$, s8, pro), 'permission denied');
  perform t.su();

  -- ---- conciliación de transferencias (RPC atómico) ----
  insert into payments(id,subscription_id,provider,amount,reference,status,plan_id) values
    ('00000000-0000-0000-0000-00000000e001', s8, 'transfer', 9000, 'tr-1', 'pending', pro),
    ('00000000-0000-0000-0000-00000000e002', s8, 'transfer', 9000, 'tr-2', 'pending', pro),
    ('00000000-0000-0000-0000-00000000e003', s8, 'mercadopago', 9000, 'mp', 'pending', pro);
  select end_date into e0 from subscriptions where id = s8;
  perform t.as_user(c8);
  perform t.err('70 un usuario común no puede conciliar', $f$select reconcile_transfer_payment('00000000-0000-0000-0000-00000000e001','reconciled')$f$, 'No autorizado');
  perform t.su();
  perform t.as_user(adm);
  r := reconcile_transfer_payment('00000000-0000-0000-0000-00000000e001', 'reconciled', 'ok');
  perform t.su();
  perform t.check('71 admin concilia: pago, suscripción, registro y auditoría en una operación',
    (select status from payments where id = '00000000-0000-0000-0000-00000000e001') = 'reconciled'
    and (select end_date from subscriptions where id = s8) = (greatest(e0, ar_today()) + interval '1 month')::date
    and (select status from subscriptions where id = s8) = 'active'
    and exists (select 1 from bank_reconciliations where payment_id = '00000000-0000-0000-0000-00000000e001' and reconciled_by = adm)
    and exists (select 1 from audit_logs where entity_id = '00000000-0000-0000-0000-00000000e001' and action = 'reconcile'));
  select end_date into e0 from subscriptions where id = s8;
  perform t.as_user(adm);
  perform t.err('72 segunda ejecución: no extiende de nuevo', $f$select reconcile_transfer_payment('00000000-0000-0000-0000-00000000e001','reconciled')$f$, 'ya fue resuelto');
  perform t.err('73 los pagos de Mercado Pago no se concilian a mano', $f$select reconcile_transfer_payment('00000000-0000-0000-0000-00000000e003','reconciled')$f$, 'transferencias');
  perform t.err('74 estado inválido', $f$select reconcile_transfer_payment('00000000-0000-0000-0000-00000000e002','approved')$f$, 'Estado inválido');
  perform t.su();
  perform t.check('75 los intentos fallidos no cambiaron nada', (select end_date from subscriptions where id = s8) = e0 and (select status from payments where id = '00000000-0000-0000-0000-00000000e002') = 'pending');
  -- fallo a mitad de la operación: todo vuelve atrás
  create or replace function t.boom() returns trigger language plpgsql as $f$ begin raise exception 'fallo simulado'; end $f$;
  execute format('create trigger t_boom before update on subscriptions for each row when (new.id = %L) execute function t.boom()', s8);
  perform t.as_user(adm);
  perform t.err('76 fallo en la extensión', $f$select reconcile_transfer_payment('00000000-0000-0000-0000-00000000e002','reconciled')$f$, 'fallo simulado');
  perform t.su();
  drop trigger t_boom on subscriptions;
  perform t.check('77 rollback: el pago NO queda conciliado, sin registro ni auditoría parcial', (select status from payments where id = '00000000-0000-0000-0000-00000000e002') = 'pending'
    and not exists (select 1 from bank_reconciliations where payment_id = '00000000-0000-0000-0000-00000000e002')
    and not exists (select 1 from audit_logs where entity_id = '00000000-0000-0000-0000-00000000e002') and (select end_date from subscriptions where id = s8) = e0);
  perform t.as_user(adm);
  r := reconcile_transfer_payment('00000000-0000-0000-0000-00000000e002', 'rejected', 'no llegó');
  perform t.su();
  perform t.check('78 rechazar no extiende', (select end_date from subscriptions where id = s8) = e0 and (select status from payments where id = '00000000-0000-0000-0000-00000000e002') = 'rejected');

  -- ---- privilegios y search_path ----
  perform t.check('80 anon/authenticated sin EXECUTE en funciones sensibles',
    not exists (select 1 from unnest(array[
      'record_mp_payment(uuid,uuid,text,text,text,numeric,text,text)','rate_limit_hit(text,integer,integer)','user_trade_limit(uuid)','enforce_user_trades_limit()',
      'subscription_has_access(text,date)','normalize_email(text)','ar_today()','handle_new_profile_trial()','grant_trial_on_email_confirmed()','sync_mp_mirror()']) f
      where has_function_privilege('anon', 'public.'||f, 'execute') or has_function_privilege('authenticated', 'public.'||f, 'execute')));
  perform t.check('81 reconcile_transfer_payment: authenticated sí, anon no', has_function_privilege('authenticated', 'public.reconcile_transfer_payment(uuid,text,text)', 'execute') and not has_function_privilege('anon', 'public.reconcile_transfer_payment(uuid,text,text)', 'execute'));
  perform t.check('82 service_role conserva record_mp_payment y rate_limit_hit', has_function_privilege('service_role', 'public.record_mp_payment(uuid,uuid,text,text,text,numeric,text,text)', 'execute') and has_function_privilege('service_role', 'public.rate_limit_hit(text,integer,integer)', 'execute'));
  perform t.check('83 la firma vieja de record_mp_payment ya no existe', to_regprocedure('public.record_mp_payment(uuid,uuid,text,text,text,numeric,text)') is null);
  perform t.check('84 todas las SECURITY DEFINER de 0023–0025 fijan search_path vacío', not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname in ('record_mp_payment','reconcile_transfer_payment','user_trade_limit','enforce_user_trades_limit','rate_limit_hit','handle_new_profile_trial','grant_trial_on_email_confirmed','sync_mp_mirror')
       and not (coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""'])));
  create schema evil; create function evil.lower(text) returns text language sql as $f$ select 'pwned'::text $f$;
  set local search_path = evil, pg_catalog, public;
  perform t.check('85 un search_path hostil del llamador no afecta a las funciones', public.normalize_email('A@B.com') = 'a@b.com');
  reset search_path;
  drop schema evil cascade;
end $$;

-- ================= 0026 =================
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000e1', 'e1@t.com', now()),
 ('00000000-0000-0000-0000-0000000000e2', 'e2@t.com', now()),
 ('00000000-0000-0000-0000-0000000000e3', 'e3@t.com', now()),
 ('00000000-0000-0000-0000-0000000000e4', 'e4@t.com', now()),
 ('00000000-0000-0000-0000-0000000000e5', 'e5@t.com', now());
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000c7'; usr uuid := '00000000-0000-0000-0000-0000000000e5';
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; pro uuid; r jsonb; e0 date;
begin
  select id into s1 from subscriptions where user_id = '00000000-0000-0000-0000-0000000000e1';
  select id into s2 from subscriptions where user_id = '00000000-0000-0000-0000-0000000000e2';
  select id into s3 from subscriptions where user_id = '00000000-0000-0000-0000-0000000000e3';
  select id into s4 from subscriptions where user_id = '00000000-0000-0000-0000-0000000000e4';
  select id into s5 from subscriptions where user_id = usr;
  select id into pro from plans where name = 'Profesional';
  update subscriptions set status = 'active', plan_id = pro, end_date = ar_today() + 10 where id in (s1, s2, s3, s4, s5);

  -- ---- Suspensión administrativa con seguimiento atómico ----
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s1, pro, 9000, 'W-1', 'authorized');
  set local role service_role;
  r := mp_begin_wind_down(s1, 'suspended', null, adm);
  reset role;
  perform t.check('86 suspender: estado local aplicado y la autorización pasa a seguimiento (cancelling) en la misma operación',
    (select status from subscriptions where id = s1) = 'suspended' and (select status from mp_preapprovals where preapproval_id = 'W-1') = 'cancelling'
    and r->>'previous_status' = 'active' and jsonb_array_length(r->'preapproval_ids') = 1
    and exists (select 1 from audit_logs where entity_id = s1 and action = 'admin_wind_down' and actor_id = adm and new_value->>'status' = 'suspended'), r::text);
  perform t.check('87 el seguimiento no marca como cancelada a MP: sigue pendiente de confirmar', (select closed_at from mp_preapprovals where preapproval_id = 'W-1') is null);
  update mp_preapprovals set cancel_attempts = 3, last_error = 'timeout' where preapproval_id = 'W-1';
  set local role service_role; r := mp_begin_wind_down(s1, 'suspended', null, adm); reset role;
  perform t.check('88 idempotente: repetirlo conserva intentos y error previos; sigue una sola fila en seguimiento',
    (select cancel_attempts from mp_preapprovals where preapproval_id = 'W-1') = 3 and (select count(*) from mp_preapprovals where subscription_id = s1) = 1
    and (select status from subscriptions where id = s1) = 'suspended');
  -- una creación en curso (sin id de MP) también queda en seguimiento
  insert into mp_preapprovals(subscription_id, plan_id, amount, status) values (s2, pro, 9000, 'creating');
  set local role service_role; r := mp_begin_wind_down(s2, 'cancelled', null, adm); reset role;
  perform t.check('89 cancelar: una creación en curso pasa a seguimiento y cancelled_at queda registrado',
    (select status from mp_preapprovals where subscription_id = s2) = 'cancelling' and (select cancelled_at from subscriptions where id = s2) is not null
    and (select status from subscriptions where id = s2) = 'cancelled');
  perform t.as_user(usr);
  perform t.err('90 un usuario no puede ejecutar mp_begin_wind_down', format($f$select mp_begin_wind_down(%L,'suspended',null,null)$f$, s5), 'permission denied');
  perform t.su();
  set local role service_role;
  perform t.err('91 estado inválido', format($f$select mp_begin_wind_down(%L,'active',null,null)$f$, s5), 'Estado inválido');
  perform t.err('92 suscripción inexistente', $f$select mp_begin_wind_down('00000000-0000-0000-0000-00000000dead','suspended',null,null)$f$, 'no encontrada');
  reset role;
  -- falla a mitad de la operación: no queda ni el estado ni el seguimiento a medias
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s3, pro, 9000, 'W-3', 'authorized');
  create or replace function t.boom2() returns trigger language plpgsql as $f$ begin raise exception 'fallo simulado 2'; end $f$;
  create trigger t_boom2 before update on mp_preapprovals for each row execute function t.boom2();
  set local role service_role;
  perform t.err('93 fallo al marcar el seguimiento', format($f$select mp_begin_wind_down(%L,'suspended',null,null)$f$, s3), 'fallo simulado 2');
  reset role;
  drop trigger t_boom2 on mp_preapprovals;
  perform t.check('94 rollback: el estado local NO cambió y la autorización sigue authorized (nada a medias)',
    (select status from subscriptions where id = s3) = 'active' and (select status from mp_preapprovals where preapproval_id = 'W-3') = 'authorized'
    and not exists (select 1 from audit_logs where entity_id = s3 and action = 'admin_wind_down'));

  -- ---- Cobros aprobados posteriores a la suspensión / cancelación ----
  select end_date into e0 from subscriptions where id = s1;
  set local role service_role;
  r := record_mp_payment(null, s1, 'MP-W1', 'approved', null, 9000, 'ARS', 'W-1');
  reset role;
  perform t.check('95 cobro recurrente tras suspender: retenido, sin extender, sin cambiar estado',
    r->>'outcome' = 'held' and r->>'reason' = 'subscription_suspended' and (select end_date from subscriptions where id = s1) = e0
    and (select status from subscriptions where id = s1) = 'suspended', r::text);
  set local role service_role; r := record_mp_payment(null, s1, 'MP-W1', 'approved', null, 9000, 'ARS', 'W-1'); reset role;
  perform t.check('96 notificación repetida del cobro retenido: duplicate, una sola incidencia, sigue sin extender',
    r->>'outcome' = 'duplicate' and (select count(*) from audit_logs where action = 'mp_incident_payment_held' and new_value->>'external_id' = 'MP-W1') = 1
    and (select end_date from subscriptions where id = s1) = e0, r::text);
  perform t.check('97 acceso: una cuenta suspendida con cobro retenido sigue SIN acceso', not subscription_has_access('suspended', ar_today() + 10) and user_trade_limit('00000000-0000-0000-0000-0000000000e1') = 0);
  -- cuenta cancelada + cobro de autorización ya cerrada => retenido; con autorización viva (re-suscripción) => se acredita
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s4, pro, 9000, 'W-4OLD', 'authorized');
  update subscriptions set status = 'cancelled', cancelled_at = now() where id = s4;
  update mp_preapprovals set status = 'cancelled', closed_at = now() where preapproval_id = 'W-4OLD';
  update subscriptions set status = 'cancelled' where id = s4;
  select end_date into e0 from subscriptions where id = s4;
  set local role service_role; r := record_mp_payment(null, s4, 'MP-W4', 'approved', null, 9000, 'ARS', 'W-4OLD'); reset role;
  perform t.check('98 cuenta cancelada + cobro de una autorización cerrada: retenido (subscription_cancelled)',
    r->>'outcome' = 'held' and r->>'reason' = 'subscription_cancelled' and (select end_date from subscriptions where id = s4) = e0 and (select status from subscriptions where id = s4) = 'cancelled', r::text);
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s4, pro, 9000, 'W-4NEW', 'authorized');
  set local role service_role; r := record_mp_payment(null, s4, 'MP-W4N', 'approved', null, 9000, 'ARS', 'W-4NEW'); reset role;
  perform t.check('99 re-suscripción: cobro de una autorización VIVA sobre cuenta cancelada se acredita y reactiva',
    r->>'outcome' = 'processed' and (select status from subscriptions where id = s4) = 'active' and (select end_date from subscriptions where id = s4) > e0, r::text);
  -- pago manual sobre cuenta cancelada: decisión explícita del usuario, se acredita
  update subscriptions set status = 'cancelled' where id = s5;
  insert into payments(id,subscription_id,provider,amount,reference,status,plan_id) values ('00000000-0000-0000-0000-00000000f0d5', s5, 'mercadopago', 9000, 'oc-d5', 'pending', pro);
  set local role service_role; r := record_mp_payment('00000000-0000-0000-0000-00000000f0d5', null, 'MP-W5', 'approved', null, 9000, 'ARS'); reset role;
  perform t.check('100 pago manual sobre cuenta cancelada: se acredita (el usuario decidió volver a pagar)', r->>'outcome' = 'processed' and (select status from subscriptions where id = s5) = 'active', r::text);

  -- ---- Resolución administrativa del cobro retenido (s1: MP-W1 retenido) ----
  perform t.as_user(usr);
  perform t.err('101 un usuario común no puede resolver cobros retenidos', format($f$select resolve_held_mp_payment(%L,'apply')$f$, (select id from payments where external_id = 'MP-W1')), 'No autorizado');
  perform t.su();
  perform t.as_user(adm);
  perform t.err('102 acción inválida', format($f$select resolve_held_mp_payment(%L,'x')$f$, (select id from payments where external_id = 'MP-W1')), 'Acción inválida');
  perform t.err('103 un pago que no está retenido no se resuelve por esta vía', format($f$select resolve_held_mp_payment(%L,'apply')$f$, (select id from payments where external_id = 'MP-W4N')), 'no es un cobro retenido');
  select end_date into e0 from subscriptions where id = s1;
  r := resolve_held_mp_payment((select id from payments where external_id = 'MP-W1'), 'apply', 'ok');
  perform t.su();
  perform t.check('104 admin aplica: extiende el período; la cuenta suspendida SIGUE suspendida; queda auditado',
    (select end_date from subscriptions where id = s1) = (greatest(e0, ar_today()) + interval '1 month')::date and (select status from subscriptions where id = s1) = 'suspended'
    and (select review_resolution from payments where external_id = 'MP-W1') = 'applied' and (select applied_at from payments where external_id = 'MP-W1') is not null
    and exists (select 1 from audit_logs where action = 'held_payment_apply' and actor_id = adm), r::text);
  perform t.as_user(adm);
  perform t.err('105 segunda resolución: ya fue resuelto, no extiende de nuevo', format($f$select resolve_held_mp_payment(%L,'apply')$f$, (select id from payments where external_id = 'MP-W1')), 'ya fue resuelto');
  perform t.su();
  -- aplicar sobre cuenta cancelada la reactiva; reembolso se marca y luego MP lo confirma
  update subscriptions set status = 'cancelled' where id = s4;
  update mp_preapprovals set status = 'cancelled' where preapproval_id = 'W-4NEW';
  perform t.as_user(adm);
  r := resolve_held_mp_payment((select id from payments where external_id = 'MP-W4'), 'refund', 'devolver');
  perform t.su();
  perform t.check('106 admin marca para reembolso: no extiende ni cambia el estado', r->>'action' = 'refund' and (select review_resolution from payments where external_id = 'MP-W4') = 'refund_pending'
    and (select status from subscriptions where id = s4) = 'cancelled' and (select applied_at from payments where external_id = 'MP-W4') is null);
  set local role service_role; r := record_mp_payment(null, s4, 'MP-W4', 'refunded', null, 9000, 'ARS', 'W-4OLD'); reset role;
  perform t.check('107 MP notifica el reembolso: el cobro pasa a refunded y queda resuelto', (select status from payments where external_id = 'MP-W4') = 'refunded'
    and (select review_resolution from payments where external_id = 'MP-W4') in ('refund_pending', 'refunded'), r::text);
  -- un cobro retenido que se reembolsa SIN pasar por el admin queda resuelto
  update subscriptions set status = 'suspended' where id = s5;
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s5, pro, 9000, 'W-5', 'cancelled');
  set local role service_role; r := record_mp_payment(null, s5, 'MP-W5B', 'approved', null, 9000, 'ARS', 'W-5'); reset role;
  set local role service_role; perform record_mp_payment(null, s5, 'MP-W5B', 'refunded', null, 9000, 'ARS', 'W-5'); reset role;
  perform t.check('108 reembolso directo de un cobro retenido: resolución "refunded"', r->>'outcome' = 'held' and (select review_resolution from payments where external_id = 'MP-W5B') = 'refunded');
  -- cobro retenido pendiente para la prueba de concurrencia (run_concurrency.sh)
  update subscriptions set status = 'suspended' where id = s2;
  update mp_preapprovals set status = 'cancelled' where subscription_id = s2;
  insert into payments(id,subscription_id,provider,amount,reference,status,plan_id,mp_status,external_id,review_reason) values
    ('00000000-0000-0000-0000-00000000e0dd', s2, 'mercadopago', 9000, 'held-conc', 'reconciled', pro, 'approved', 'MP-HELD-CONC', 'subscription_suspended');
  -- privilegios
  perform t.check('109 privilegios: wind_down solo service_role; resolve_held authenticated (no anon)',
    has_function_privilege('service_role', 'public.mp_begin_wind_down(uuid,text,uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.mp_begin_wind_down(uuid,text,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.mp_begin_wind_down(uuid,text,uuid,uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.resolve_held_mp_payment(uuid,text,text)', 'execute')
    and not has_function_privilege('anon', 'public.resolve_held_mp_payment(uuid,text,text)', 'execute')
    and has_function_privilege('service_role', 'public.record_mp_payment(uuid,uuid,text,text,text,numeric,text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.record_mp_payment(uuid,uuid,text,text,text,numeric,text,text)', 'execute'));
  perform t.check('110 las funciones nuevas fijan search_path vacío', not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('mp_begin_wind_down', 'resolve_held_mp_payment', 'record_mp_payment')
       and not (coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""'])));
end $$;

-- ================= 0027 =================
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000f1', 'f1@t.com', now()),
 ('00000000-0000-0000-0000-0000000000f2', 'f2@t.com', now()),
 ('00000000-0000-0000-0000-0000000000f3', 'f3@t.com', now()),
 ('00000000-0000-0000-0000-0000000000f4', 'f4@t.com', now());
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000c7';
  f1 uuid := '00000000-0000-0000-0000-0000000000f1'; f2 uuid := '00000000-0000-0000-0000-0000000000f2';
  f3 uuid := '00000000-0000-0000-0000-0000000000f3'; f4 uuid := '00000000-0000-0000-0000-0000000000f4';
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; pro uuid; r jsonb;
begin
  select id into s1 from subscriptions where user_id = f1; select id into s2 from subscriptions where user_id = f2;
  select id into s3 from subscriptions where user_id = f3; select id into s4 from subscriptions where user_id = f4;
  select id into pro from plans where name = 'Profesional';
  update subscriptions set status = 'active', plan_id = pro, end_date = ar_today() + 10 where id in (s1, s2, s3, s4);

  -- ---- guardia de alta: no se abren autorizaciones sobre cuentas suspendidas ----
  update subscriptions set status = 'suspended' where id = s1;
  perform t.err('111 no se abre una autorización sobre una cuenta suspendida', format($f$insert into mp_preapprovals(subscription_id,plan_id,amount,status) values (%L,%L,9000,'creating')$f$, s1, pro), 'mp:renewals_blocked');
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s1, pro, 9000, 'G-CLOSED', 'cancelled');
  perform t.check('112 un registro histórico (cerrado) sí puede insertarse', exists (select 1 from mp_preapprovals where preapproval_id = 'G-CLOSED'));
  -- una cuenta CANCELADA conserva la posibilidad normal de volver a suscribirse
  update subscriptions set status = 'cancelled' where id = s2;
  insert into mp_preapprovals(subscription_id, plan_id, amount, status) values (s2, pro, 9000, 'creating');
  perform t.check('113 cuenta cancelada: puede abrir una autorización nueva (re-suscripción normal)', (select count(*) from mp_preapprovals where subscription_id = s2 and status = 'creating') = 1);
  update mp_preapprovals set status = 'cancelled', closed_at = now() where subscription_id = s2;

  -- ---- retención de eliminación ----
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s3, pro, 9000, 'D-1', 'authorized');
  perform t.as_user(f4);
  perform t.err('114 un usuario no puede ejecutar mp_begin_user_deletion', format($f$select mp_begin_user_deletion(%L,null)$f$, f3), 'permission denied');
  perform t.err('115 un usuario no puede ejecutar mp_end_user_deletion_hold', format($f$select mp_end_user_deletion_hold(%L)$f$, f3), 'permission denied');
  perform t.su();
  set local role service_role; r := mp_begin_user_deletion(f3, adm); reset role;
  perform t.check('116 begin_user_deletion: retención activa, autorización en seguimiento (cancelling) y auditoría',
    exists (select 1 from mp_deletion_holds where user_id = f3) and (select status from mp_preapprovals where preapproval_id = 'D-1') = 'cancelling'
    and jsonb_array_length(r->'preapproval_ids') = 1 and exists (select 1 from audit_logs where action = 'admin_delete_user_hold' and entity_id = f3 and actor_id = adm), r::text);
  update mp_preapprovals set status = 'cancelled', closed_at = now() where preapproval_id = 'D-1';
  perform t.err('117 con la retención vigente NO se abre otra autorización (aunque la cuenta no esté suspendida)', format($f$insert into mp_preapprovals(subscription_id,plan_id,amount,status) values (%L,%L,9000,'creating')$f$, s3, pro), 'mp:renewals_blocked');
  update mp_deletion_holds set held_at = now() - interval '31 minutes' where user_id = f3;
  insert into mp_preapprovals(subscription_id, plan_id, amount, status) values (s3, pro, 9000, 'creating');
  perform t.check('118 la retención vence sola a los 30 min (no bloquea la cuenta para siempre)', (select count(*) from mp_preapprovals where subscription_id = s3 and status = 'creating') = 1);
  update mp_preapprovals set status = 'cancelled', closed_at = now() where subscription_id = s3 and status = 'creating';
  update mp_deletion_holds set held_at = now() where user_id = f3;
  set local role service_role; perform mp_end_user_deletion_hold(f3); reset role;
  perform t.check('119 end_user_deletion_hold libera la retención', not exists (select 1 from mp_deletion_holds where user_id = f3));
  insert into mp_preapprovals(subscription_id, plan_id, amount, status) values (s3, pro, 9000, 'creating');
  perform t.check('120 liberada la retención, la cuenta puede volver a suscribirse', (select count(*) from mp_preapprovals where subscription_id = s3 and status = 'creating') = 1);
  update mp_preapprovals set status = 'cancelled', closed_at = now() where subscription_id = s3 and status = 'creating';
  set local role service_role; r := mp_begin_user_deletion(f3, adm); r := mp_begin_user_deletion(f3, adm); reset role;
  perform t.check('121 begin_user_deletion es idempotente', jsonb_array_length(r->'preapproval_ids') = 0 and exists (select 1 from mp_deletion_holds where user_id = f3));
  delete from mp_deletion_holds where user_id = f3;

  -- ---- guardia de borrado: nada se elimina con una autorización abierta o sin confirmar ----
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s4, pro, 9000, 'D-4', 'cancelling');
  perform t.err('122 no se puede borrar la suscripción con una cancelación SIN confirmar', format($f$delete from subscriptions where id = %L$f$, s4), 'mp:open_preapproval');
  perform t.err('123 ni el usuario completo (borrado en cascada desde auth.users)', format($f$delete from auth.users where id = %L$f$, f4), 'mp:open_preapproval');
  perform t.check('124 tras el intento, usuario, suscripción y ledger siguen intactos (nada se borró a medias)',
    exists (select 1 from auth.users where id = f4) and exists (select 1 from subscriptions where id = s4) and exists (select 1 from mp_preapprovals where preapproval_id = 'D-4'));
  update mp_preapprovals set status = 'authorized' where preapproval_id = 'D-4';
  perform t.err('125 tampoco con una autorización viva', format($f$delete from auth.users where id = %L$f$, f4), 'mp:open_preapproval');
  update mp_preapprovals set status = 'cancelled', closed_at = now() where preapproval_id = 'D-4';
  delete from auth.users where id = f4;
  perform t.check('126 con la cancelación CONFIRMADA el borrado procede y el ledger se elimina en cascada', not exists (select 1 from auth.users where id = f4) and not exists (select 1 from mp_preapprovals where preapproval_id = 'D-4'));

  -- ---- carrera: decisión con estado vigente (ver run_race_record.sh para la versión con sesiones reales) ----
  -- Orden de lectura determinista: con la fila del ledger ya CANCELADA y la cuenta cancelada, un cobro aprobado se retiene.
  update subscriptions set status = 'cancelled' where id = s1;
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s1, pro, 9000, 'R-1', 'cancelled');
  set local role service_role; r := record_mp_payment(null, s1, 'MP-R-1', 'approved', null, 9000, 'ARS', 'R-1'); reset role;
  perform t.check('127 cobro de una autorización cancelada sobre cuenta cancelada: retenido, la cuenta no se reactiva', r->>'outcome' = 'held' and (select status from subscriptions where id = s1) = 'cancelled', r::text);

  -- privilegios y search_path de lo nuevo
  perform t.check('128 privilegios 0027: solo service_role ejecuta begin/end deletion; nadie directo las auxiliares',
    has_function_privilege('service_role', 'public.mp_begin_user_deletion(uuid,uuid)', 'execute') and has_function_privilege('service_role', 'public.mp_end_user_deletion_hold(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.mp_begin_user_deletion(uuid,uuid)', 'execute') and not has_function_privilege('anon', 'public.mp_begin_user_deletion(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.mp_end_user_deletion_hold(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.mp_guard_subscription_delete()', 'execute') and not has_function_privilege('authenticated', 'public.mp_user_deletion_hold_active(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.sync_mp_mirror()', 'execute') and has_function_privilege('service_role', 'public.mp_begin_wind_down(uuid,text,uuid,uuid)', 'execute'));
  perform t.check('129 las funciones de 0027 fijan search_path vacío', not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('mp_begin_user_deletion', 'mp_end_user_deletion_hold', 'mp_guard_subscription_delete', 'mp_user_deletion_hold_active', 'mp_expire_intent', 'mp_guard_subscription_insert', 'mp_guard_payment_insert', 'sync_mp_mirror', 'record_mp_payment', 'mp_begin_wind_down')
       and not (coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""'])));
end $$;

-- ================= 0028: pagos únicos y cuentas sin suscripción durante la eliminación =================
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000b1', 'b1@t.com', now()),
 ('00000000-0000-0000-0000-0000000000b2', 'b2@t.com', now()),
 ('00000000-0000-0000-0000-0000000000b3', 'b3@t.com', now()),
 ('00000000-0000-0000-0000-0000000000b4', 'b4@t.com', now()),
 ('00000000-0000-0000-0000-0000000000b5', 'b5@t.com', now());
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000c7';
  b1 uuid := '00000000-0000-0000-0000-0000000000b1'; b2 uuid := '00000000-0000-0000-0000-0000000000b2';
  b3 uuid := '00000000-0000-0000-0000-0000000000b3'; b4 uuid := '00000000-0000-0000-0000-0000000000b4';
  b5 uuid := '00000000-0000-0000-0000-0000000000b5';
  s2 uuid; s3 uuid; s4 uuid; s5 uuid; pro uuid; r jsonb; pid uuid; pid2 uuid;
begin
  select id into s2 from subscriptions where user_id = b2; select id into s3 from subscriptions where user_id = b3;
  select id into s4 from subscriptions where user_id = b4; select id into s5 from subscriptions where user_id = b5;
  select id into pro from plans where name = 'Profesional';
  update subscriptions set status = 'active', plan_id = pro, end_date = ar_today() + 10 where id in (s2, s3, s4, s5);

  -- ---- cuenta SIN fila en subscriptions (caso 6) ----
  delete from subscriptions where user_id = b1;
  perform t.check('130 la cuenta b1 no tiene fila en subscriptions', not exists (select 1 from subscriptions where user_id = b1));
  set local role service_role; r := mp_begin_user_deletion(b1, adm); reset role;
  perform t.check('131 begin_user_deletion funciona SIN suscripción: la retención por usuario queda registrada', exists (select 1 from mp_deletion_holds where user_id = b1) and jsonb_array_length(r->'subscription_ids') = 0, r::text);
  perform t.err('132 con la retención vigente no se puede crear la suscripción (checkout de cuenta sin suscripción)', format($f$insert into subscriptions(user_id, plan_id, status, end_date) values (%L, %L, 'past_due', ar_today() - 2)$f$, b1, pro), 'mp:renewals_blocked');
  perform t.check('133 y no quedó ninguna suscripción creada', not exists (select 1 from subscriptions where user_id = b1));
  set local role service_role; perform mp_end_user_deletion_hold(b1); reset role;
  insert into subscriptions(user_id, plan_id, status, end_date) values (b1, pro, 'past_due', ar_today() - 2);
  perform t.check('134 liberada la retención, la cuenta sin suscripción puede crearla (checkout normal)', exists (select 1 from subscriptions where user_id = b1));

  -- ---- intenciones de pago bajo retención ----
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values (s2, pro, 9000, 'B2-PRE', 'authorized');
  set local role service_role; r := mp_begin_user_deletion(b2, adm); reset role;
  perform t.err('135 con la retención NO se crea una intención de pago único', format($f$insert into payments(subscription_id, provider, amount, status, plan_id, mp_status) values (%L, 'mercadopago', 9000, 'pending', %L, 'created')$f$, s2, pro), 'mp:renewals_blocked');
  perform t.err('136 ni una transferencia a revisar (INSERT directo)', format($f$insert into payments(subscription_id, provider, amount, status, plan_id) values (%L, 'transfer', 9000, 'pending', %L)$f$, s2, pro), 'mp:renewals_blocked');
  set local role service_role;
  r := record_mp_payment(null, s2, 'MP-B2-REC', 'approved', null, 9000, 'ARS', 'B2-PRE');
  reset role;
  perform t.check('137 un cobro REAL de MP (con external_id) se registra aunque haya retención: nunca se pierde', exists (select 1 from payments where external_id = 'MP-B2-REC'), r::text);
  set local role service_role; perform mp_end_user_deletion_hold(b2); reset role;

  -- ---- cuenta cancelada que se vuelve a suscribir fuera de una eliminación (caso 9) ----
  update subscriptions set status = 'cancelled' where id = s3;
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status) values (s3, 'mercadopago', 9000, 'pending', pro, 'created');
  insert into mp_preapprovals(subscription_id, plan_id, amount, status) values (s3, pro, 9000, 'creating');
  perform t.check('138 cuenta cancelada sin eliminación en curso: puede crear intención y autorización nuevas (re-suscripción normal)',
    exists (select 1 from payments where subscription_id = s3 and status = 'pending') and exists (select 1 from mp_preapprovals where subscription_id = s3 and status = 'creating'));
  update mp_preapprovals set status = 'cancelled', closed_at = now() where subscription_id = s3;
  update payments set status = 'rejected', mp_status = 'expired' where subscription_id = s3 and status = 'pending';

  -- ---- guardia de borrado: pagos pendientes (casos 1 y 8) ----
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status) values (s4, 'mercadopago', 9000, 'pending', pro, 'created') returning id into pid;
  perform t.err('139 no se elimina la suscripción con un pago único PENDIENTE', format($f$delete from subscriptions where id = %L$f$, s4), 'mp:pending_payments');
  perform t.err('140 ni el usuario completo (cascada desde auth.users)', format($f$delete from auth.users where id = %L$f$, b4), 'mp:pending_payments');
  perform t.check('141 tras el intento todo sigue intacto (usuario, suscripción y pago)', exists (select 1 from auth.users where id = b4) and exists (select 1 from subscriptions where id = s4) and exists (select 1 from payments where id = pid));
  update payments set status = 'reconciled', mp_status = 'in_process', external_id = 'MP-B4-1' where id = pid;
  perform t.err('142 tampoco con un pago EN PROCESO (conciliado sin aplicar ni resolver)', format($f$delete from auth.users where id = %L$f$, b4), 'mp:pending_payments');
  -- transferencia pendiente
  update payments set status = 'rejected' where id = pid;
  insert into payments(subscription_id, provider, amount, status, plan_id) values (s4, 'transfer', 9000, 'pending', pro);
  perform t.err('143 ni con una transferencia pendiente de revisión', format($f$delete from subscriptions where id = %L$f$, s4), 'mp:pending_payments');
  update payments set status = 'rejected' where subscription_id = s4 and provider = 'transfer';   -- 0030: los pagos ya no se borran directamente; se rechaza
  -- cobro retenido sin resolver
  update payments set status = 'reconciled', applied_at = null, review_reason = 'subscription_suspended', review_resolution = null where id = pid;
  perform t.err('144 ni con un cobro retenido sin resolver', format($f$delete from subscriptions where id = %L$f$, s4), 'mp:pending_payments');
  -- conciliación posterior: resuelto => el borrado procede y deja instantánea
  update payments set review_resolution = 'refunded', reviewed_at = now() where id = pid;
  delete from auth.users where id = b4;
  perform t.check('145 resuelto el cobro, la eliminación procede', not exists (select 1 from auth.users where id = b4));
  perform t.check('146 y deja una instantánea de los pagos de MP en audit_logs (nada desaparece sin rastro)',
    exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = s4 and old_value::text like '%MP-B4-1%'));
  perform t.check('147 el perfil eliminado limpia su retención', not exists (select 1 from mp_deletion_holds where user_id = b4));

  -- ---- pago aprobado y aplicado: la eliminación procede con instantánea ----
  update subscriptions set status = 'cancelled' where id = s5;
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, applied_at) values (s5, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-B5-OK', now());
  delete from auth.users where id = b5;
  perform t.check('148 un pago aprobado y aplicado no bloquea; queda instantánea con su external_id',
    not exists (select 1 from auth.users where id = b5) and exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = s5 and old_value::text like '%MP-B5-OK%'));

  -- ---- begin_user_deletion informa los pagos por conciliar; es idempotente ----
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status) values (s3, 'mercadopago', 9000, 'pending', pro, 'creation_uncertain') returning id into pid2;
  set local role service_role; r := mp_begin_user_deletion(b3, adm); r := mp_begin_user_deletion(b3, adm); reset role;
  perform t.check('149 begin_user_deletion lista los pagos por conciliar y es idempotente', r->'pending_payment_ids' @> to_jsonb(array[pid2]) and (select count(*) from mp_deletion_holds where user_id = b3) = 1, r::text);
  set local role service_role; perform mp_end_user_deletion_hold(b3); reset role;

  -- ---- mp_expire_intent (caso 4: timeout; solo se cierra lo vencido y sin pago asociado) ----
  set local role service_role;
  r := mp_expire_intent(pid2);
  reset role;
  perform t.check('150 una intención incierta RECIENTE no se cierra (la preferencia puede seguir vigente)', r->>'reason' = 'too_recent' and (select status from payments where id = pid2) = 'pending', r::text);
  update payments set created_at = now() - interval '26 hours' where id = pid2;
  update payments set external_id = 'MP-B3-X' where id = pid2;
  set local role service_role; r := mp_expire_intent(pid2); reset role;
  perform t.check('151 con un pago asociado (external_id) NO se cierra por vencimiento, aunque sea vieja', r->>'reason' = 'not_expirable' and (select status from payments where id = pid2) = 'pending', r::text);
  update payments set external_id = null where id = pid2;
  set local role service_role; r := mp_expire_intent(pid2); reset role;
  perform t.check('152 vencida (>25 h) y sin pago asociado: se cierra como vencida y se audita',
    (r->>'expired')::boolean and (select mp_status from payments where id = pid2) = 'expired' and exists (select 1 from audit_logs where action = 'mp_intent_expired' and entity_id = pid2), r::text);
  perform t.as_user(b3);
  perform t.err('153 un usuario no puede ejecutar mp_expire_intent', format($f$select mp_expire_intent(%L)$f$, pid2), 'permission denied');
  perform t.su();

  -- ---- privilegios ----
  perform t.as_user(b3);
  perform t.err('154 un usuario no puede leer mp_deletion_holds', $f$select * from mp_deletion_holds$f$, 'permission denied');
  perform t.su();
  perform t.check('155 service_role ejecuta expire/begin/end; los usuarios no', has_function_privilege('service_role', 'public.mp_expire_intent(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.mp_expire_intent(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.mp_user_deletion_hold_active(uuid)', 'execute'));
end $$;

-- ================= 0029: instantánea financiera y trazado tras la eliminación =================
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000aa', 'aa@t.com', now()), ('00000000-0000-0000-0000-0000000000ab', 'ab@t.com', now());
do $$
declare
  ua uuid := '00000000-0000-0000-0000-0000000000aa'; ub uuid := '00000000-0000-0000-0000-0000000000ab';
  sa uuid; sb uuid; pro uuid; r jsonb; one_id uuid; snap jsonb; n int;
begin
  select id into sa from subscriptions where user_id = ua; select id into sb from subscriptions where user_id = ub;
  select id into pro from plans where name = 'Profesional';
  update subscriptions set status = 'cancelled', plan_id = pro where id in (sa, sb);
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, mp_status_detail, external_id, applied_at, checkout_url, proof_url, reference)
    values (sa, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'accredited', 'MP-AA-ONE', now(), 'https://mp/secret-checkout', 'https://proof/x', null) returning id into one_id;
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, applied_at, reference)
    values (sa, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-AA-REC', now(), 'preapproval:AA-PRE');
  insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status, closed_at) values (sa, pro, 9000, 'AA-PRE', 'cancelled', now());
  delete from auth.users where id = ua;
  select old_value into snap from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = sa;
  perform t.check('156 la eliminación conserva en audit_logs la instantánea de la cuenta y sus 2 pagos + 1 autorización',
    snap is not null and snap->>'user_id' = ua::text and snap->>'subscription_id' = sa::text and jsonb_array_length(snap->'payments') = 2 and jsonb_array_length(snap->'preapprovals') = 1, snap::text);
  perform t.check('157 el pago único conserva id de MP, referencia externa, importe, moneda, estados, plan y fechas',
    exists (select 1 from jsonb_array_elements(snap->'payments') e where e->>'external_id' = 'MP-AA-ONE' and e->>'payment_id' = one_id::text and (e->>'amount')::numeric = 9000
      and e->>'currency' = 'ARS' and e->>'status' = 'reconciled' and e->>'mp_status' = 'approved' and e->>'mp_status_detail' = 'accredited' and e->>'plan_id' = pro::text
      and e->>'applied_at' is not null and e->>'created_at' is not null and e->>'provider' = 'mercadopago'), snap::text);
  perform t.check('158 la renovación conserva su referencia de preapproval y el ledger conserva ids de MP y estado',
    exists (select 1 from jsonb_array_elements(snap->'payments') e where e->>'external_id' = 'MP-AA-REC' and e->>'reference' = 'preapproval:AA-PRE')
    and exists (select 1 from jsonb_array_elements(snap->'preapprovals') e where e->>'preapproval_id' = 'AA-PRE' and e->>'status' = 'cancelled' and e->>'closed_at' is not null and e->>'id' is not null));
  perform t.check('159 la instantánea NO contiene enlaces de pago, comprobantes, email ni tokens',
    snap::text not ilike '%secret-checkout%' and snap::text not ilike '%proof%' and snap::text not ilike '%aa@t.com%' and snap::text not ilike '%checkout_url%' and snap::text not ilike '%token%' and snap::text not ilike '%access%');
  perform t.check('160 los pagos y el ledger desaparecieron por cascada (solo queda la instantánea)', not exists (select 1 from payments where external_id like 'MP-AA-%') and not exists (select 1 from mp_preapprovals where preapproval_id = 'AA-PRE'));

  -- conciliación posterior: trazado por cada identificador
  set local role service_role;
  perform t.check('161 trazado por id de pago de MP (external_id)', (mp_trace_deleted_payment('MP-AA-ONE')->>'found')::boolean and mp_trace_deleted_payment('MP-AA-ONE')->>'user_id' = ua::text and mp_trace_deleted_payment('MP-AA-ONE')->>'subscription_id' = sa::text);
  perform t.check('162 trazado por external_reference del pago único (payments.id)', (mp_trace_deleted_payment(one_id::text)->'payment'->>'external_id') = 'MP-AA-ONE');
  perform t.check('163 trazado por id de preapproval de MP y por referencia de renovación', (mp_trace_deleted_payment('AA-PRE')->>'found')::boolean and mp_trace_deleted_payment('AA-PRE')->'payment'->>'external_id' = 'MP-AA-REC' and mp_trace_deleted_payment('AA-PRE')->'preapproval'->>'status' = 'cancelled');
  perform t.check('164 un identificador desconocido no devuelve nada', not (mp_trace_deleted_payment('NO-EXISTE')->>'found')::boolean and not (mp_trace_deleted_payment(null)->>'found')::boolean);
  -- webhook posterior: el registro local ya no existe => record_mp_payment lo rechaza SIN crear nada; el rastro permite atribuirlo
  begin
    r := record_mp_payment(one_id, null, 'MP-AA-LATE', 'approved', null, 9000, 'ARS', null);
    reset role; perform t.check('165 un cobro posterior sobre una cuenta eliminada no se registra', false, r::text);
  exception when others then
    reset role; perform t.check('165 un cobro posterior sobre una cuenta eliminada se rechaza (mp:intent_not_found) y no crea filas', sqlerrm like '%mp:intent_not_found%' and not exists (select 1 from payments where external_id = 'MP-AA-LATE'), sqlerrm);
  end;
  reset role;
  -- lo conservado no se puede alterar ni borrar por un usuario normal
  perform t.as_user(ub);
  perform t.err('166 un usuario no puede borrar la instantánea (0030: sin privilegio DELETE)', format($f$delete from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = %L$f$, sa), 'permission denied');
  perform t.err('167 un usuario no puede ejecutar mp_trace_deleted_payment', $f$select mp_trace_deleted_payment('MP-AA-ONE')$f$, 'permission denied');
  perform t.su();
  perform t.check('168 la instantánea sigue ahí tras el intento de borrado', exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = sa));
  -- cuenta sin pagos ni ledger: no genera ruido
  delete from auth.users where id = ub;
  perform t.check('169 una cuenta sin pagos ni autorizaciones no genera instantánea', not exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = sb));
  perform t.check('170 privilegios 0029: la guardia y el trazado no son ejecutables por usuarios; search_path fijo',
    not has_function_privilege('authenticated', 'public.mp_guard_subscription_delete()', 'execute') and has_function_privilege('service_role', 'public.mp_trace_deleted_payment(text)', 'execute')
    and not exists (select 1 from pg_proc p where p.proname in ('mp_trace_deleted_payment', 'mp_guard_subscription_delete') and not (coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""'])));
end $$;

-- ================= 0030: integridad de audit_logs, reembolso pendiente y borrado de pagos =================
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000b0', 'b0@t.com', now()), ('00000000-0000-0000-0000-0000000000ba', 'ba@t.com', now()),
 ('00000000-0000-0000-0000-0000000000bb', 'bb@t.com', now()), ('00000000-0000-0000-0000-0000000000bc', 'bc@t.com', now()),
 ('00000000-0000-0000-0000-0000000000bd', 'bd@t.com', now()), ('00000000-0000-0000-0000-0000000000be', 'be@t.com', now()),
 ('00000000-0000-0000-0000-0000000000bf', 'bf@t.com', now());
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000c7';
  b0 uuid := '00000000-0000-0000-0000-0000000000b0'; ba uuid := '00000000-0000-0000-0000-0000000000ba';
  s0 uuid; sa uuid; pro uuid; r jsonb; n_before int; n_after int; fake uuid; fake2 uuid; fake3 uuid; fake4 uuid; fake5 uuid; pay_id uuid; live_ext text;
begin
  select id into s0 from subscriptions where user_id = b0; select id into sa from subscriptions where user_id = ba;
  select id into pro from plans where name = 'Profesional';
  update subscriptions set status = 'cancelled', plan_id = pro where id in (s0, sa);

  -- ================= A. audit_logs =================
  perform t.as_user(b0);
  perform t.err('171 un usuario autenticado NO puede insertar una instantánea financiera falsa', format($f$insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (null, 'subscriptions', %L, 'mp_payments_snapshot_on_delete', '{"user_id":"x","payments":[{"external_id":"FAKE-30"}]}')$f$, s0), 'audit:reserved_action');
  perform t.err('172 ni otras acciones reservadas (mp_*, admin_delete_user_*)', format($f$insert into audit_logs(actor_id, entity, entity_id, action, new_value) values (%L, 'payments', %L, 'mp_incident_payment_held', '{}')$f$, b0, s0), 'audit:reserved_action');
  perform t.err('172b ni admin_delete_user_hold', format($f$insert into audit_logs(actor_id, entity, entity_id, action, new_value) values (%L, 'profiles', %L, 'admin_delete_user_hold', '{}')$f$, b0, b0), 'audit:reserved_action');
  perform t.err('173 no puede atribuir la fila a OTRO usuario', format($f$insert into audit_logs(actor_id, entity, entity_id, action, new_value) values (%L, 'regions', %L, 'update', '{}')$f$, ba, s0), 'audit:actor_mismatch');
  perform t.err('174 no puede escribir old_value con las operaciones normales del cliente', format($f$insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (%L, 'regions', %L, 'update', '{"x":1}')$f$, b0, s0), 'audit:old_value_forbidden');
  perform t.err('174b ni siquiera simulando discard_draft si no es administrador', format($f$insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (%L, 'price_list_versions', %L, 'discard_draft', '{"x":1}')$f$, b0, s0), 'audit:old_value_forbidden');
  perform t.su();
  perform t.as_user('00000000-0000-0000-0000-000000000000'::uuid);
  perform t.su();
  set local role anon;
  perform t.err('175 un usuario anónimo no puede insertar auditoría', format($f$insert into audit_logs(entity, entity_id, action, new_value) values ('regions', %L, 'create', '{}')$f$, s0), 'permission denied');
  reset role;
  perform t.as_user(b0);
  insert into audit_logs(actor_id, entity, entity_id, action, new_value) values (b0, 'regions', s0, 'create', '{"name":"x"}');
  insert into audit_logs(actor_id, entity, entity_id, action, new_value) values (null, 'regions', s0, 'update', '{"name":"y"}');
  perform t.su();
  perform t.check('176 las inserciones legítimas del cliente (actor propio o nulo, new_value) siguen funcionando', (select count(*) from audit_logs where entity = 'regions' and entity_id = s0 and action in ('create', 'update')) = 2);
  -- el respaldo legítimo de discard_draft_version (administrador, old_value)
  perform t.as_user(adm);
  insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (adm, 'price_list_versions', s0, 'discard_draft', '{"version":{},"items":[]}');
  perform t.su();
  perform t.check('177 el respaldo de discard_draft de un ADMINISTRADOR (old_value) sigue permitido', exists (select 1 from audit_logs where action = 'discard_draft' and entity_id = s0 and actor_id = adm));
  -- El servidor (service_role) SÍ puede escribir acciones reservadas (store.logIncident). El arnés local no concede tablas a service_role: se concede y revoca dentro de la prueba.
  grant insert on public.audit_logs to service_role;
  set local role service_role;
  insert into audit_logs(actor_id, entity, entity_id, action, new_value) values (adm, 'profiles', s0, 'mp_incident_server_side_test', '{}');
  insert into audit_logs(actor_id, entity, entity_id, action, new_value) values (adm, 'profiles', s0, 'admin_delete_user_renewals_cancelled', '{}');
  reset role;
  revoke insert on public.audit_logs from service_role;
  perform t.check('177b service_role puede escribir acciones reservadas (incidentes y auditoría administrativa)', (select count(*) from audit_logs where entity_id = s0 and action in ('mp_incident_server_side_test', 'admin_delete_user_renewals_cancelled')) = 2);
  delete from audit_logs where entity_id = s0 and action in ('mp_incident_server_side_test', 'admin_delete_user_renewals_cancelled');
  -- Defensa en profundidad: cada capa por separado
  create policy zz_permissive_audit on public.audit_logs for insert to authenticated with check (true);
  perform t.as_user(b0);
  perform t.err('178a una política permisiva extra NO neutraliza la protección (la restrictiva + el trigger siguen rechazando)', format($f$insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (null, 'subscriptions', %L, 'mp_payments_snapshot_on_delete', '{}')$f$, s0), 'audit:reserved_action');
  perform t.su();
  alter table public.audit_logs disable trigger trg_audit_logs_client_guard;
  perform t.as_user(b0);
  perform t.err('178b SIN el trigger, la política RESTRICTIVE sola rechaza (aun con la permisiva extra)', format($f$insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (null, 'subscriptions', %L, 'mp_payments_snapshot_on_delete', '{}')$f$, s0), 'row-level security');
  perform t.err('178c ídem actor ajeno', format($f$insert into audit_logs(actor_id, entity, entity_id, action, new_value) values (%L, 'regions', %L, 'update', '{}')$f$, ba, s0), 'row-level security');
  perform t.su();
  alter table public.audit_logs enable trigger trg_audit_logs_client_guard;
  drop policy zz_permissive_audit on public.audit_logs;
  alter table public.audit_logs disable row level security;
  perform t.as_user(b0);
  perform t.err('178d SIN RLS, el trigger solo rechaza', format($f$insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (null, 'subscriptions', %L, 'mp_payments_snapshot_on_delete', '{}')$f$, s0), 'audit:reserved_action');
  perform t.su();
  alter table public.audit_logs enable row level security;
  perform t.as_user(b0);
  perform t.err('178e el cliente no puede actualizar ni borrar auditoría (sin privilegio)', $f$update audit_logs set action = 'x'$f$, 'permission denied');
  perform t.err('178f ídem DELETE', $f$delete from audit_logs$f$, 'permission denied');
  perform t.su();

  -- Las funciones autorizadas SÍ generan instantáneas válidas y el trazado las encuentra
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, applied_at) values (sa, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-BA-1', now()) returning id into pay_id;
  delete from auth.users where id = ba;
  perform t.check('179 la guardia (SECURITY DEFINER) escribe la instantánea aun con el trigger de auditoría activo', exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = sa and actor_id is null));
  set local role service_role;
  perform t.check('180 mp_trace_deleted_payment encuentra la instantánea legítima', (mp_trace_deleted_payment('MP-BA-1')->>'found')::boolean and mp_trace_deleted_payment(pay_id::text)->>'subscription_id' = sa::text);
  reset role;
  -- service_role (servidor) puede escribir incidentes reservados
  set local role service_role; perform 1; reset role;

  -- ---- consulta de diagnóstico ----
  select count(*) into n_before from audit_logs;
  select count(*) into n_after from audit_logs where action = 'mp_payments_snapshot_on_delete';
  perform t.check('181 sin falsificaciones, la consulta de diagnóstico no marca instantáneas legítimas', (select count(*) from public.mp_audit_suspicious_snapshots()) = 0, (select string_agg(reasons::text, ';') from public.mp_audit_suspicious_snapshots()));
  fake := gen_random_uuid(); fake2 := gen_random_uuid(); fake4 := gen_random_uuid(); fake5 := gen_random_uuid();
  select external_id into live_ext from payments where external_id is not null and provider = 'mercadopago' limit 1;
  -- (insertadas como dueño: simulan filas históricas fabricadas antes de 0030)
  insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (b0, 'subscriptions', fake, 'mp_payments_snapshot_on_delete', jsonb_build_object('user_id', b0, 'subscription_id', fake, 'payments', '[]'::jsonb));
  insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (null, 'subscriptions', fake2, 'mp_payments_snapshot_on_delete', jsonb_build_object('user_id', b0, 'subscription_id', gen_random_uuid(), 'payments', '[]'::jsonb));
  insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (null, 'subscriptions', s0, 'mp_payments_snapshot_on_delete', jsonb_build_object('user_id', b0, 'subscription_id', s0, 'payments', '[]'::jsonb));
  insert into audit_logs(actor_id, entity, entity_id, action, old_value) values (null, 'subscriptions', fake4, 'mp_payments_snapshot_on_delete', jsonb_build_object('user_id', b0, 'subscription_id', fake4, 'payments', jsonb_build_array(jsonb_build_object('external_id', live_ext))));
  insert into audit_logs(actor_id, entity, entity_id, action, new_value) values (b0, 'payments', fake5, 'mp_incident_forged', '{}');
  set local role service_role;
  perform t.check('182 el diagnóstico marca las 5 filas sospechosas y solo esas',
    (select count(*) from public.mp_audit_suspicious_snapshots()) = 5
    and exists (select 1 from public.mp_audit_suspicious_snapshots() d where d.entity_id = fake and 'actor_id_no_nulo' = any(d.reasons))
    and exists (select 1 from public.mp_audit_suspicious_snapshots() d where d.entity_id = fake2 and 'subscription_id_no_coincide' = any(d.reasons))
    and exists (select 1 from public.mp_audit_suspicious_snapshots() d where d.entity_id = s0 and 'suscripcion_todavia_existe' = any(d.reasons))
    and exists (select 1 from public.mp_audit_suspicious_snapshots() d where d.entity_id = fake4 and 'pago_todavia_existe' = any(d.reasons))
    and exists (select 1 from public.mp_audit_suspicious_snapshots() d where d.entity_id = fake5 and 'accion_reservada_actor_no_admin' = any(d.reasons)),
    (select string_agg(d.entity_id || ':' || d.reasons::text, ' | ') from public.mp_audit_suspicious_snapshots() d));
  reset role;
  perform t.check('183 el diagnóstico es de solo lectura: no borra ni modifica las filas', (select count(*) from audit_logs) = n_before + 5 and (select count(*) from audit_logs where entity_id in (fake, fake2, fake4, fake5)) = 4);
  perform t.as_user(b0);
  perform t.err('184 un usuario no puede ejecutar el diagnóstico', $f$select * from mp_audit_suspicious_snapshots()$f$, 'permission denied');
  perform t.su();
  -- Las falsificaciones del propio test no deben contaminar el trazado de los demás tests
  delete from audit_logs where entity_id in (fake, fake2, fake4, fake5, s0) and action in ('mp_payments_snapshot_on_delete', 'mp_incident_forged');
end $$;

-- ---- B. reembolso pendiente ----
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000c7';
  bb uuid := '00000000-0000-0000-0000-0000000000bb'; bc uuid := '00000000-0000-0000-0000-0000000000bc'; bd uuid := '00000000-0000-0000-0000-0000000000bd';
  sb uuid; sc uuid; sd uuid; pro uuid; pid uuid; before_row jsonb; after_row jsonb; r jsonb;
begin
  select id into sb from subscriptions where user_id = bb; select id into sc from subscriptions where user_id = bc; select id into sd from subscriptions where user_id = bd;
  select id into pro from plans where name = 'Profesional';
  update subscriptions set status = 'suspended', plan_id = pro where id in (sb, sc, sd);
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, review_reason, review_resolution, reviewed_at, reviewed_by)
    values (sb, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-BB-RP', 'subscription_suspended', 'refund_pending', now(), adm) returning id into pid;
  select to_jsonb(p) into before_row from payments p where id = pid;
  perform t.err('185 un pago con reembolso PENDIENTE impide eliminar la suscripción', format($f$delete from subscriptions where id = %L$f$, sb), 'mp:pending_payments');
  perform t.err('186 ni la cuenta completa (cascada desde auth.users)', format($f$delete from auth.users where id = %L$f$, bb), 'mp:pending_payments');
  select to_jsonb(p) into after_row from payments p where id = pid;
  perform t.check('187 el pago y su información de revisión permanecen intactos', before_row = after_row and exists (select 1 from auth.users where id = bb) and exists (select 1 from subscriptions where id = sb), after_row::text);
  set local role service_role; r := mp_begin_user_deletion(bb, adm); reset role;
  perform t.check('188 begin_user_deletion lista el reembolso pendiente entre los pagos por conciliar', r->'pending_payment_ids' @> to_jsonb(array[pid]), r::text);
  delete from mp_deletion_holds where user_id = bb;
  -- estados ya resueltos: siguen el comportamiento previsto (no bloquean)
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, review_reason, review_resolution, reviewed_at)
    values (sc, 'mercadopago', 9000, 'reconciled', pro, 'refunded', 'MP-BC-RF', 'subscription_suspended', 'refunded', now());
  delete from auth.users where id = bc;
  perform t.check('189 un cobro retenido ya REEMBOLSADO no bloquea y deja su instantánea con review_resolution', not exists (select 1 from auth.users where id = bc)
    and exists (select 1 from audit_logs a, jsonb_array_elements(a.old_value->'payments') e where a.action = 'mp_payments_snapshot_on_delete' and a.entity_id = sc and e->>'review_resolution' = 'refunded'));
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, applied_at, review_reason, review_resolution, reviewed_at)
    values (sd, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-BD-AP', now(), 'subscription_suspended', 'applied', now());
  delete from auth.users where id = bd;
  perform t.check('190 un cobro retenido ya APLICADO no bloquea', not exists (select 1 from auth.users where id = bd));
  -- pasar de refund_pending a refunded (resolución del reembolso) habilita la eliminación
  update payments set review_resolution = 'refunded', mp_status = 'refunded' where id = pid;
  delete from auth.users where id = bb;
  perform t.check('191 al completarse el reembolso (refunded) la eliminación procede y conserva la instantánea', not exists (select 1 from auth.users where id = bb)
    and exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = sb and old_value::text like '%MP-BB-RP%'));
end $$;

-- ---- C. borrado de pagos ----
do $$
declare
  be uuid := '00000000-0000-0000-0000-0000000000be'; bf uuid := '00000000-0000-0000-0000-0000000000bf';
  se uuid; sf uuid; pro uuid; p_applied uuid; p_pend uuid; p_rp uuid; p_held uuid; p_ref uuid; p_rejx uuid; p_failed uuid; n int;
  x1 uuid := gen_random_uuid(); x2 uuid := gen_random_uuid(); x3 uuid := gen_random_uuid();
  ux1 uuid := gen_random_uuid(); ux2 uuid := gen_random_uuid(); ux3 uuid := gen_random_uuid(); sx1 uuid; sx2 uuid; sx3 uuid;
begin
  select id into se from subscriptions where user_id = be; select id into sf from subscriptions where user_id = bf; select id into pro from plans where name = 'Profesional';
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, applied_at) values (se, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-BE-AP', now()) returning id into p_applied;
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status) values (se, 'mercadopago', 9000, 'pending', pro, 'created') returning id into p_pend;
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, review_reason, review_resolution) values (se, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-BE-RP', 'subscription_suspended', 'refund_pending') returning id into p_rp;
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, review_reason) values (se, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-BE-HELD', 'subscription_suspended') returning id into p_held;
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, review_reason, review_resolution) values (se, 'mercadopago', 9000, 'reconciled', pro, 'refunded', 'MP-BE-RF', 'subscription_suspended', 'refunded') returning id into p_ref;
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id) values (se, 'mercadopago', 9000, 'rejected', pro, 'rejected', 'MP-BE-REJ') returning id into p_rejx;
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status) values (se, 'mercadopago', 9000, 'rejected', pro, 'creation_failed') returning id into p_failed;
  select count(*) into n from payments where subscription_id = se;

  perform t.err('192 el borrado DIRECTO de un pago aplicado es rechazado', format($f$delete from payments where id = %L$f$, p_applied), 'mp:direct_payment_delete');
  perform t.err('193 ídem un pago pendiente', format($f$delete from payments where id = %L$f$, p_pend), 'mp:direct_payment_delete');
  perform t.err('194 ídem un reembolso pendiente', format($f$delete from payments where id = %L$f$, p_rp), 'mp:direct_payment_delete');
  perform t.err('195 ídem un cobro retenido sin resolver', format($f$delete from payments where id = %L$f$, p_held), 'mp:direct_payment_delete');
  perform t.err('196 ídem un cobro reembolsado (es un registro financiero)', format($f$delete from payments where id = %L$f$, p_ref), 'mp:direct_payment_delete');
  perform t.err('197 ídem un pago rechazado por MP (tiene external_id)', format($f$delete from payments where id = %L$f$, p_rejx), 'mp:direct_payment_delete');
  perform t.err('198 y un DELETE masivo de la tabla (sin where)', 'delete from payments', 'mp:direct_payment_delete');
  perform t.check('199 los pagos y su trazabilidad se conservan tras los intentos', (select count(*) from payments where subscription_id = se) = n and not exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = se));
  delete from payments where id = p_failed;
  perform t.check('200 única excepción: una intención de MP que nunca produjo un pago (rechazada, sin external_id) sí se puede borrar', not exists (select 1 from payments where id = p_failed));
  perform t.as_user(be);
  perform t.err('201 un usuario no tiene privilegio DELETE sobre payments', format($f$delete from payments where id = %L$f$, p_applied), 'permission denied');
  perform t.su();

  -- cascada con la guardia de suscripción DESHABILITADA: la guardia de los pagos protege por sí sola (un caso por usuario: el orden de la cascada no es fijo)
  declare uy uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()]; sy uuid[] := '{}'; k int;
  begin
    for k in 1..4 loop
      insert into auth.users(id,email,email_confirmed_at) values (uy[k], 'y' || k || '@t.com', now());
      sy := sy || (select id from subscriptions where user_id = uy[k]);
    end loop;
    insert into payments(subscription_id, provider, amount, status, plan_id, mp_status) values (sy[1], 'mercadopago', 9000, 'pending', pro, 'created');
    insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, review_reason, review_resolution) values (sy[2], 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-Y2', 'subscription_suspended', 'refund_pending');
    insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, review_reason) values (sy[3], 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-Y3', 'subscription_suspended');
    insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, applied_at) values (sy[4], 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-Y4', now());
    alter table public.subscriptions disable trigger trg_mp_guard_subscription_delete;
    perform t.err('202 cascada sin la guardia de suscripción: no borra un pago pendiente', format($f$delete from auth.users where id = %L$f$, uy[1]), 'mp:pending_payments');
    perform t.err('203 ni un reembolso pendiente', format($f$delete from auth.users where id = %L$f$, uy[2]), 'mp:pending_payments');
    perform t.err('204 ni un cobro retenido sin resolver', format($f$delete from auth.users where id = %L$f$, uy[3]), 'mp:pending_payments');
    perform t.err('205 ni siquiera uno aplicado si NO hay instantánea (mp:snapshot_missing)', format($f$delete from auth.users where id = %L$f$, uy[4]), 'mp:snapshot_missing');
    alter table public.subscriptions enable trigger trg_mp_guard_subscription_delete;
    perform t.check('206 tras todos los rechazos, ningún pago se perdió', (select count(*) from payments where subscription_id = any(sy)) = 4);
    -- con la guardia activa, los no resueltos siguen rechazados y el aplicado procede
    perform t.err('206b con la guardia activa, el pendiente sigue rechazado', format($f$delete from auth.users where id = %L$f$, uy[1]), 'mp:pending_payments');
    delete from auth.users where id = uy[4];
    perform t.check('206c y el aplicado procede (con instantánea)', not exists (select 1 from payments where external_id = 'MP-Y4') and exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and old_value::text like '%MP-Y4%'));
  end;
  update payments set status = 'rejected' where id = p_pend;
  update payments set review_resolution = 'refunded' where id = p_rp;
  update payments set review_resolution = 'applied', applied_at = now() where id = p_held;

  -- cascadas legítimas por cada camino real de eliminación
  delete from auth.users where id = be;
  perform t.check('207 cascada desde auth.users con todo resuelto: procede y la instantánea contiene los pagos', not exists (select 1 from payments where subscription_id = se)
    and (select jsonb_array_length(old_value->'payments') from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = se) = n - 1);

  insert into auth.users(id,email,email_confirmed_at) values (ux1,'x1@t.com',now()), (ux2,'x2@t.com',now()), (ux3,'x3@t.com',now());
  select id into sx1 from subscriptions where user_id = ux1; select id into sx2 from subscriptions where user_id = ux2; select id into sx3 from subscriptions where user_id = ux3;
  insert into payments(subscription_id, provider, amount, status, plan_id, mp_status, external_id, applied_at) values (sx1, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-X1', now()), (sx2, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-X2', now()), (sx3, 'mercadopago', 9000, 'reconciled', pro, 'approved', 'MP-X3', now());
  delete from subscriptions where id = sx1;
  perform t.check('208 cascada desde DELETE de subscriptions: procede con instantánea', not exists (select 1 from payments where external_id = 'MP-X1') and exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = sx1 and old_value::text like '%MP-X1%'));
  delete from profiles where id = ux2;
  perform t.check('209 cascada desde DELETE de profiles: procede con instantánea', not exists (select 1 from payments where external_id = 'MP-X2') and exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = sx2 and old_value::text like '%MP-X2%'));
  delete from auth.users where id = ux3;
  perform t.check('210 cascada desde auth.users: procede con instantánea', not exists (select 1 from payments where external_id = 'MP-X3') and exists (select 1 from audit_logs where action = 'mp_payments_snapshot_on_delete' and entity_id = sx3 and old_value::text like '%MP-X3%'));
  set local role service_role;
  perform t.check('211 la trazabilidad posterior encuentra los tres cobros', (mp_trace_deleted_payment('MP-X1')->>'found')::boolean and (mp_trace_deleted_payment('MP-X2')->>'found')::boolean and (mp_trace_deleted_payment('MP-X3')->>'found')::boolean and (mp_trace_deleted_payment('MP-BE-AP')->>'found')::boolean);
  reset role;
  delete from auth.users where id = ux2;
  perform t.check('212 privilegios 0030: funciones nuevas sin acceso de usuarios y con search_path fijo; diagnóstico solo service_role',
    not has_function_privilege('authenticated', 'public.mp_guard_payment_delete()', 'execute') and not has_function_privilege('authenticated', 'public.mp_guard_payment_truncate()', 'execute')
    and not has_function_privilege('anon', 'public.mp_audit_suspicious_snapshots()', 'execute') and has_function_privilege('service_role', 'public.mp_audit_suspicious_snapshots()', 'execute')
    and not exists (select 1 from pg_proc p where p.proname in ('mp_guard_payment_delete', 'mp_guard_payment_truncate', 'mp_audit_suspicious_snapshots', 'audit_logs_client_guard') and not (coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""'])));
end $$;

-- TRUNCATE al final (si la protección fallara, vaciaría datos de prueba)
do $$
declare n1 int; n2 int;
begin
  select count(*) into n1 from payments;
  perform t.err('213 TRUNCATE payments CASCADE es rechazado', 'truncate payments cascade', 'mp:direct_payment_delete');
  perform t.err('214 TRUNCATE subscriptions CASCADE (alcanza a payments) es rechazado', 'truncate subscriptions cascade', 'mp:direct_payment_delete');
  select count(*) into n2 from payments;
  perform t.check('215 los pagos siguen ahí tras los TRUNCATE', n1 = n2 and n1 > 0, n1 || '/' || n2);
end $$;

\echo ===== RESULTADOS =====
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '   -> ' || coalesce(detail,'') end from t.results order by n;
select 'TOTAL: ' || count(*) || '  PASS: ' || count(*) filter (where ok) || '  FAIL: ' || count(*) filter (where not ok) from t.results;

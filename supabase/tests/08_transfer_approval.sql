-- Etapa 1: circuito de aprobación/rechazo de transferencias. DB de PRUEBAS aislada (run_transfer.sh).
-- Cada prueba lleva el número del escenario obligatorio (V1..V8) del pedido.
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
 ('00000000-0000-0000-0000-0000000000c1','a@t.com',now()),
 ('00000000-0000-0000-0000-0000000000c2','b@t.com',now()),
 ('00000000-0000-0000-0000-0000000000c3','adm@t.com',now());
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c3';

do $$
declare
  ua uuid := '00000000-0000-0000-0000-0000000000c1'; ub uuid := '00000000-0000-0000-0000-0000000000c2'; adm uuid := '00000000-0000-0000-0000-0000000000c3';
  sa uuid; sb uuid; pm uuid; pa uuid; pb uuid; pr uuid; pmp uuid; pc uuid;
  ea date; eb date; ea2 date; r jsonb; n int; n2 int;
begin
  select id into pm from plans where name = 'Profesional';
  select id into sa from subscriptions where user_id = ua;
  select id into sb from subscriptions where user_id = ub;
  update subscriptions set plan_id = pm, status = 'trial', end_date = current_date + 2 where id in (sa, sb);
  select end_date into ea from subscriptions where id = sa;
  select end_date into eb from subscriptions where id = sb;

  -- el usuario informa su transferencia como lo hace la app (reportTransferPayment): insert propio, estado pending
  perform t.as_user(ua);
  insert into payments(subscription_id, provider, amount, reference, proof_url, status) values (sa, 'transfer', 9000, 'OP-A-1', 'https://ejemplo.com/a.png', 'pending') returning id into pa;
  insert into payments(subscription_id, provider, amount, reference, status) values (sa, 'transfer', 9000, 'OP-A-2', 'pending') returning id into pr;
  insert into payments(subscription_id, provider, amount, reference, status) values (sa, 'transfer', 9000, 'OP-A-3', 'pending') returning id into pc;
  perform t.err('V8a el usuario no puede informar una transferencia YA conciliada', format($f$insert into payments(subscription_id, provider, amount, status) values (%L, 'transfer', 9000, 'reconciled')$f$, sa), 'row-level security');
  perform t.su();
  perform t.as_user(ub);
  insert into payments(subscription_id, provider, amount, reference, status) values (sb, 'transfer', 9000, 'OP-B-1', 'pending') returning id into pb;
  perform t.err('V8b ni a nombre de la suscripción de otro usuario', format($f$insert into payments(subscription_id, provider, amount, status) values (%L, 'transfer', 1, 'pending')$f$, sa), 'row-level security');
  perform t.su();
  insert into payments(subscription_id, provider, amount, reference, status) values (sa, 'mercadopago', 9000, 'mp', 'pending') returning id into pmp;

  -- ===== V1: pendiente visible para el administrador (y solo para su dueño) =====
  perform t.as_user(adm);
  perform t.check('V1 el administrador ve los pagos pendientes con importe, referencia y comprobante',
    (select count(*) from payments where provider = 'transfer' and status = 'pending') = 4
    and (select proof_url from payments where id = pa) = 'https://ejemplo.com/a.png' and (select reference from payments where id = pa) = 'OP-A-1');
  perform t.su();
  perform t.as_user(ub);
  perform t.check('V7a otro usuario no ve el pago ajeno', (select count(*) from payments where id = pa) = 0);
  perform t.su();

  -- ===== V5: usuario común incapaz de aprobar =====
  perform t.as_user(ua);
  perform t.err('V5a el dueño del pago no puede aprobar su propia transferencia', format($f$select reconcile_transfer_payment(%L,'reconciled')$f$, pa), 'No autorizado');
  perform t.err('V5b ni rechazar', format($f$select reconcile_transfer_payment(%L,'rejected','x')$f$, pa), 'No autorizado');
  update payments set status = 'reconciled' where id = pa;
  get diagnostics n = row_count;
  perform t.check('V5c ni cambiar el estado con un UPDATE directo (RLS: 0 filas)', n = 0);
  perform t.err('V5d ni escribir conciliaciones', format($f$insert into bank_reconciliations(payment_id, reconciled_by, status) values (%L, %L, 'reconciled')$f$, pa, ua), 'row-level security');
  perform t.su();
  perform t.as_user(ub);
  perform t.err('V5e otro usuario común tampoco', format($f$select reconcile_transfer_payment(%L,'reconciled')$f$, pa), 'No autorizado');
  perform t.su();
  execute 'set local role anon';
  perform t.err('V5f sin sesión: sin permiso de ejecución', format($f$select reconcile_transfer_payment(%L,'reconciled')$f$, pa), 'permission denied');
  perform t.su();
  perform t.check('V5g nada cambió: sigue pendiente y la suscripción intacta', (select status from payments where id = pa) = 'pending' and (select end_date from subscriptions where id = sa) = ea and (select status from subscriptions where id = sa) = 'trial');

  -- ===== V2: aprobación válida =====
  perform t.as_user(adm);
  r := reconcile_transfer_payment(pa, 'reconciled', 'Ingresó el 12/11');
  perform t.su();
  perform t.check('V2a aprueba: pago conciliado y suscripción ACTIVA con vigencia extendida un mes',
    (select status from payments where id = pa) = 'reconciled'
    and (select status from subscriptions where id = sa) = 'active'
    and (select end_date from subscriptions where id = sa) = (greatest(ea, ar_today()) + interval '1 month')::date
    and (r->>'end_date')::date = (select end_date from subscriptions where id = sa), r::text);
  perform t.check('V2b queda registro auditable: quién, qué, cuándo y nota',
    exists (select 1 from bank_reconciliations where payment_id = pa and reconciled_by = adm and status = 'reconciled' and notes = 'Ingresó el 12/11' and created_at is not null)
    and exists (select 1 from audit_logs where entity = 'payments' and entity_id = pa and action = 'reconcile' and actor_id = adm and new_value->>'status' = 'reconciled'));

  -- ===== V3: doble clic / reintento =====
  select end_date into ea2 from subscriptions where id = sa;
  perform t.as_user(adm);
  perform t.err('V3a segundo clic: rechazado, no extiende otra vez', format($f$select reconcile_transfer_payment(%L,'reconciled')$f$, pa), 'ya fue resuelto');
  perform t.err('V3b reintento con otro estado tampoco', format($f$select reconcile_transfer_payment(%L,'rejected','x')$f$, pa), 'ya fue resuelto');
  perform t.su();
  select count(*) into n from bank_reconciliations where payment_id = pa;
  select count(*) into n2 from audit_logs where entity_id = pa and action = 'reconcile';
  perform t.check('V3c una sola conciliación, una sola auditoría y la vigencia no cambió', n = 1 and n2 = 1 and (select end_date from subscriptions where id = sa) = ea2);

  -- ===== V4: rechazo con motivo =====
  perform t.as_user(adm);
  r := reconcile_transfer_payment(pr, 'rejected', 'No figura en el banco');
  perform t.su();
  perform t.check('V4a rechaza: pago rechazado, la suscripción NO se modifica',
    (select status from payments where id = pr) = 'rejected' and (select end_date from subscriptions where id = sa) = ea2 and (select status from subscriptions where id = sa) = 'active' and r->>'status' = 'rejected');
  perform t.check('V4b el motivo queda en el historial y en la auditoría',
    exists (select 1 from bank_reconciliations where payment_id = pr and status = 'rejected' and notes = 'No figura en el banco' and reconciled_by = adm)
    and exists (select 1 from audit_logs where entity_id = pr and action = 'reconcile' and new_value->>'status' = 'rejected' and new_value->>'notes' = 'No figura en el banco'));

  -- ===== V6: un pago ya resuelto no vuelve a aprobarse =====
  perform t.as_user(adm);
  perform t.err('V6a un rechazado no puede aprobarse después', format($f$select reconcile_transfer_payment(%L,'reconciled')$f$, pr), 'ya fue resuelto');
  perform t.su();
  perform t.check('V6b sigue rechazado y sin extensión', (select status from payments where id = pr) = 'rejected' and (select end_date from subscriptions where id = sa) = ea2);

  -- ===== V7: un pago no afecta a otro usuario =====
  perform t.check('V7b la suscripción y el pago del otro usuario quedaron intactos',
    (select status from subscriptions where id = sb) = 'trial' and (select end_date from subscriptions where id = sb) = eb
    and (select status from payments where id = pb) = 'pending'
    and not exists (select 1 from bank_reconciliations where payment_id = pb));

  -- ===== V8: errores sin estados inconsistentes =====
  perform t.as_user(adm);
  perform t.err('V8c pago inexistente', $f$select reconcile_transfer_payment('00000000-0000-0000-0000-00000000dead','reconciled')$f$, 'Pago no encontrado');
  perform t.err('V8d los pagos de Mercado Pago no se concilian a mano', format($f$select reconcile_transfer_payment(%L,'reconciled')$f$, pmp), 'transferencias');
  perform t.err('V8e estado inválido', format($f$select reconcile_transfer_payment(%L,'approved')$f$, pc), 'Estado inválido');
  perform t.su();
  create or replace function t.boom() returns trigger language plpgsql as $f$ begin raise exception 'fallo simulado'; end $f$;
  execute format('create trigger t_boom before update on subscriptions for each row when (new.id = %L) execute function t.boom()', sa);
  perform t.as_user(adm);
  perform t.err('V8f fallo a mitad de la aprobación', format($f$select reconcile_transfer_payment(%L,'reconciled')$f$, pc), 'fallo simulado');
  perform t.su();
  drop trigger t_boom on subscriptions;
  perform t.check('V8g rollback total: el pago sigue pendiente, sin conciliación ni auditoría, suscripción igual',
    (select status from payments where id = pc) = 'pending' and not exists (select 1 from bank_reconciliations where payment_id = pc)
    and not exists (select 1 from audit_logs where entity_id = pc) and (select end_date from subscriptions where id = sa) = ea2);
  perform t.check('V8h el pago de MP sigue intacto', (select status from payments where id = pmp) = 'pending');

  -- listado: pendientes, aprobados y rechazados conviven y el administrador los ve a todos
  perform t.as_user(adm);
  perform t.check('V1b el administrador ve pendientes, conciliados y rechazados',
    (select count(distinct status) from payments where provider = 'transfer') = 3);
  perform t.su();

  -- pago para la prueba de concurrencia (la lanza run_transfer.sh en sesiones paralelas)
  perform t.as_user(ua);
  insert into payments(id, subscription_id, provider, amount, reference, status) values ('00000000-0000-0000-0000-00000000c0c0', sa, 'transfer', 9000, 'OP-CONC', 'pending');
  perform t.su();
end $$;

\echo ===== RESULTADOS =====
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '   -> ' || coalesce(detail,'') end from t.results order by n;
select 'TOTAL: ' || count(*) || '  PASS: ' || count(*) filter (where ok) || '  FAIL: ' || count(*) filter (where not ok) from t.results;

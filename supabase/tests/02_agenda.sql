-- Pruebas SQL de la migración 0022 (agenda). Se corre con run_agenda.sh sobre una DB de PRUEBAS aislada.
-- La DB llega hasta 0021: acá se siembran datos previos y luego se aplica 0022.
\set ON_ERROR_STOP on
\pset tuples_only on
create schema if not exists t;
grant usage on schema t to anon, authenticated;
create table if not exists t.results(n serial, name text, ok boolean, detail text);
grant all on t.results to anon, authenticated; grant usage on all sequences in schema t to anon, authenticated;
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

-- ---------- datos previos a 0022 ----------
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000b1','u1@t'),
 ('00000000-0000-0000-0000-0000000000b2','u2@t');
insert into customers(id,user_id,name,address) values
 ('00000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-0000000000b1','Ana','Mitre 123'),
 ('00000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-0000000000b1','Beto',null),
 ('00000000-0000-0000-0000-00000000c009','00000000-0000-0000-0000-0000000000b2','Ajeno',null);
insert into quotes(id,user_id,customer_id,status,number) values
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000c001','accepted',1),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000c001','draft',2);
insert into client_jobs(id,user_id,customer_id,description,job_date)
 values ('00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000c001','Trabajo histórico','2026-09-01');
do $$ declare s uuid; c uuid; begin
  insert into trades(name,slug) values ('T','t') returning id into s;
  insert into categories(trade_id,name) values (s,'C') returning id into c;
  insert into services(id,category_id,name) values ('00000000-0000-0000-0000-0000000005e1', c, 'Cambio de canilla');
  insert into quote_items(quote_id,service_id,quantity,unit_price,subtotal)
    values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000005e1',1,1000,1000);
end $$;

\ir ../migrations/0022_agenda_jobs.sql

-- ---------- compatibilidad ----------
select t.check('1a el trabajo histórico sigue ahí como Terminado (done)',
  (select status='done' and job_date='2026-09-01' and customer_id is not null from client_jobs where id='00000000-0000-0000-0000-00000000d001'));
select t.check('1b updated_at de filas previas = created_at',
  (select updated_at=created_at from client_jobs where id='00000000-0000-0000-0000-00000000d001'));
select t.check('1c quote_items.description rellenado con el nombre vigente',
  (select description='Cambio de canilla' from quote_items limit 1));

-- ---------- reglas ----------
do $$
declare u1 uuid := '00000000-0000-0000-0000-0000000000b1'; c1 uuid := '00000000-0000-0000-0000-00000000c001';
        c2 uuid := '00000000-0000-0000-0000-00000000c002'; c9 uuid := '00000000-0000-0000-0000-00000000c009';
        qa uuid := '00000000-0000-0000-0000-0000000000a1'; qd uuid := '00000000-0000-0000-0000-0000000000a2';
        j1 uuid; before_ts timestamptz;
begin
  perform t.as_user(u1);
  insert into client_jobs(user_id,description,status) values (u1,'Sin cliente ni fecha','pending');
  perform t.check('2 trabajo pendiente sin cliente y sin fecha', exists (select 1 from client_jobs where description='Sin cliente ni fecha' and customer_id is null and job_date is null));

  perform t.err('3 Programado sin fecha', format($f$insert into client_jobs(user_id,description,status) values (%L,'x','scheduled')$f$, u1), 'client_jobs_schedule_chk');
  perform t.err('4 horario sin fecha', format($f$insert into client_jobs(user_id,description,status,start_time) values (%L,'x','pending','09:00')$f$, u1), 'client_jobs_time_needs_date_chk');
  perform t.err('5 estado inválido', format($f$insert into client_jobs(user_id,description,status) values (%L,'x','borrado')$f$, u1), 'client_jobs_status_chk');
  perform t.err('6 cliente de otro profesional', format($f$insert into client_jobs(user_id,customer_id,description,status) values (%L,%L,'x','pending')$f$, u1, c9), 'no pertenece');
  perform t.err('7 presupuesto no aceptado', format($f$insert into client_jobs(user_id,customer_id,quote_id,description,status) values (%L,%L,%L,'x','pending')$f$, u1, c1, qd), 'presupuesto aceptado');
  perform t.err('8 cliente distinto al del presupuesto', format($f$insert into client_jobs(user_id,customer_id,quote_id,description,status) values (%L,%L,%L,'x','pending')$f$, u1, c2, qa), 'no coincide');

  insert into client_jobs(user_id,customer_id,quote_id,description,status,job_date,start_time,duration_minutes)
    values (u1,c1,qa,'Desde presupuesto','scheduled','2026-10-20','09:00',90) returning id into j1;
  perform t.check('9a trabajo vinculado a presupuesto y cliente', exists (select 1 from client_jobs where id=j1 and quote_id=qa and customer_id=c1));
  perform t.err('9b segundo trabajo activo para el mismo presupuesto', format($f$insert into client_jobs(user_id,customer_id,quote_id,description,status) values (%L,%L,%L,'dup','pending')$f$, u1, c1, qa), 'client_jobs_one_active_per_quote');

  select updated_at into before_ts from client_jobs where id=j1;
  perform pg_sleep(0.01);
  update client_jobs set job_date='2026-10-22' where id=j1;
  perform t.check('10 updated_at se renueva al modificar', (select updated_at > before_ts from client_jobs where id=j1));
  perform t.err('10b no se puede mover a un cliente que no coincide con el presupuesto', format($f$update client_jobs set customer_id=%L where id=%L$f$, c2, j1), 'no coincide');

  update client_jobs set status='cancelled', cancel_reason='Prueba' where id=j1;
  insert into client_jobs(user_id,customer_id,quote_id,description,status) values (u1,c1,qa,'Reprogramado tras cancelar','pending');
  perform t.check('9c cancelado, el presupuesto puede volver a programarse', (select count(*) from client_jobs where quote_id=qa)=2);
  perform t.su();

  -- RLS: otro profesional no ve ni modifica
  perform t.as_user('00000000-0000-0000-0000-0000000000b2');
  perform t.check('11a otro profesional no ve los trabajos', (select count(*) from client_jobs where user_id=u1)=0);
  update client_jobs set description='hack' where user_id=u1;
  perform t.su();
  perform t.check('11b y tampoco los modifica', not exists (select 1 from client_jobs where description='hack'));

  -- borrar el presupuesto no borra el trabajo
  delete from quotes where id=qa;
  perform t.check('12 al borrar el presupuesto el trabajo queda (quote_id = null)', (select count(*) from client_jobs where description='Desde presupuesto' and quote_id is null)=1);
end $$;

\echo ===== RESULTADOS =====
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '   -> ' || coalesce(detail,'') end from t.results order by n;
select 'TOTAL: ' || count(*) || '  PASS: ' || count(*) filter (where ok) || '  FAIL: ' || count(*) filter (where not ok) from t.results;

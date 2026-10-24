-- Pruebas SQL de la migración 0035 (catálogo propio + integridad de presupuestos).
-- Correr con run_catalogo.sh sobre una DB de PRUEBAS (todas las migraciones aplicadas).
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

-- ---------- datos ----------
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000e1','e1@t'), ('00000000-0000-0000-0000-0000000000e2','e2@t');
insert into customers(id,user_id,name) values
 ('00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-0000000000e1','Ana'),
 ('00000000-0000-0000-0000-00000000f002','00000000-0000-0000-0000-0000000000e1','Beto'),
 ('00000000-0000-0000-0000-00000000f009','00000000-0000-0000-0000-0000000000e2','Ajeno');
do $$ declare s uuid; c uuid; begin
  insert into trades(name,slug) values ('T35','t35') returning id into s;
  insert into categories(trade_id,name) values (s,'C35') returning id into c;
  insert into services(id,category_id,name) values ('00000000-0000-0000-0000-0000000035e1', c, 'Cambio de canilla');
end $$;

do $$
declare
  u1 uuid := '00000000-0000-0000-0000-0000000000e1'; u2 uuid := '00000000-0000-0000-0000-0000000000e2';
  c1 uuid := '00000000-0000-0000-0000-00000000f001'; c2 uuid := '00000000-0000-0000-0000-00000000f002';
  c9 uuid := '00000000-0000-0000-0000-00000000f009'; sv uuid := '00000000-0000-0000-0000-0000000035e1';
  ci uuid; ci2 uuid; r jsonb; q1 uuid; q2 uuid; q3 uuid; req uuid := gen_random_uuid(); n1 int;
  stamp1 jsonb; stamp2 jsonb; j uuid;
begin
  -- ===== catálogo propio =====
  perform t.as_user(u1);
  insert into catalog_items(user_id,name,unit_price,unit_label) values (u2,'  Flete  ',1500.50,'viaje') returning id into ci;
  perform t.su();
  perform t.check('C1 el user_id enviado por el cliente se ignora: queda el del usuario autenticado',
    (select user_id = u1 and name = 'Flete' from catalog_items where id = ci));

  perform t.as_user(u1);
  perform t.err('C2 no admite nombre repetido entre activos', format($f$insert into catalog_items(user_id,name,unit_price) values (%L,'flete',1)$f$, u1), 'catalog_items_unique_active_name');
  perform t.err('C3 precio negativo', format($f$insert into catalog_items(user_id,name,unit_price) values (%L,'Neg',-1)$f$, u1), 'check');
  perform t.err('C4 nombre vacío', format($f$insert into catalog_items(user_id,name,unit_price) values (%L,'   ',1)$f$, u1), 'check');
  perform t.err('C5 no se puede borrar (solo desactivar)', format($f$delete from catalog_items where id = %L$f$, ci), 'permission denied');
  update catalog_items set is_active = false where id = ci;
  insert into catalog_items(user_id,name,unit_price) values (u1,'Flete',2000) returning id into ci2;
  perform t.check('C6 desactivado el anterior, se puede volver a crear el nombre', ci2 is not null);
  perform t.su();

  perform t.as_user(u2);
  perform t.check('C7 otro profesional no ve el catálogo ajeno', (select count(*) from catalog_items) = 0);
  update catalog_items set unit_price = 1 where id in (ci, ci2);
  perform t.su();
  perform t.check('C8 ni lo modifica', (select unit_price from catalog_items where id = ci2) = 2000);
  perform t.as_user(u2);
  update catalog_items set user_id = u2 where id = ci2;
  get diagnostics n1 = row_count;
  perform t.check('C9 otro profesional no puede apropiarse de un concepto ajeno (0 filas afectadas por RLS)', n1 = 0);
  perform t.su();
  perform t.as_user(u1);
  update catalog_items set user_id = u2 where id = ci2;   -- ni el dueño puede regalarlo/cambiar la propiedad
  perform t.su();
  perform t.check('C9b la propiedad no se puede cambiar: sigue siendo del dueño', (select user_id = u1 from catalog_items where id = ci2));

  -- ===== save_quote =====
  perform t.as_user(u1);
  r := save_quote(req, null, c1, 'Obs', jsonb_build_array(
        jsonb_build_object('service_id', sv, 'description','Cambio de canilla','quantity',2,'unit_price',1000,'unit_label','Trabajo'),
        jsonb_build_object('catalog_item_id', ci2, 'description','Flete','quantity',1,'unit_price',2000),
        jsonb_build_object('description','Concepto libre','quantity',3,'unit_price',1.005)));
  q1 := (r->>'id')::uuid; n1 := (r->>'number')::int;
  perform t.check('Q1 crea borrador con número 1', n1 = 1 and (r->>'created')::boolean);
  perform t.check('Q2 total = suma de subtotales redondeados (2000 + 2000 + 3.03)', (r->>'total')::numeric = 4003.03, r::text);
  perform t.check('Q3 conserva servicio, concepto propio y libre', (select count(*) filter (where service_id is not null) = 1 and count(*) filter (where catalog_item_id is not null) = 1 and count(*) filter (where service_id is null and catalog_item_id is null) = 1 from quote_items where quote_id = q1));
  perform t.check('Q4 orden de líneas conservado', (select array_agg(description order by position) = array['Cambio de canilla','Flete','Concepto libre'] from quote_items where quote_id = q1));

  r := save_quote(req, null, c1, 'Obs', jsonb_build_array(jsonb_build_object('description','Reintento','quantity',1,'unit_price',10)));
  perform t.check('Q5 el reintento con el mismo request_id NO crea otro presupuesto', (select count(*) from quotes where user_id = u1 and client_request_id = req) = 1 and (r->>'id')::uuid = q1);

  r := save_quote(gen_random_uuid(), null, null, null, jsonb_build_array(jsonb_build_object('description','Otro','quantity',1,'unit_price',5)));
  q2 := (r->>'id')::uuid;
  perform t.check('Q6 segundo presupuesto toma número 2 (sin cliente)', (r->>'number')::int = 2);
  delete from quotes where id = q1;
  r := save_quote(gen_random_uuid(), null, null, null, jsonb_build_array(jsonb_build_object('description','Tercero','quantity',1,'unit_price',5)));
  q3 := (r->>'id')::uuid;
  perform t.check('Q7 tras borrar el Nº1, el siguiente es 3 (no repite el 2)', (r->>'number')::int = 3, r::text);

  perform t.err('Q8 cantidad 0', format($f$select save_quote(gen_random_uuid(), %L, null, null, '[{"description":"x","quantity":0,"unit_price":1}]'::jsonb)$f$, q2), 'cantidad');
  perform t.err('Q9 precio negativo', format($f$select save_quote(gen_random_uuid(), %L, null, null, '[{"description":"x","quantity":1,"unit_price":-1}]'::jsonb)$f$, q2), 'precio');
  perform t.err('Q10 línea sin descripción', format($f$select save_quote(gen_random_uuid(), %L, null, null, '[{"description":"  ","quantity":1,"unit_price":1}]'::jsonb)$f$, q2), 'descripción');
  perform t.err('Q11 cliente de otro profesional', format($f$select save_quote(gen_random_uuid(), %L, %L, null, '[]'::jsonb)$f$, q2, c9), 'no pertenece');
  perform t.err('Q12 insertar directo un presupuesto con cliente ajeno', format($f$insert into quotes(user_id,customer_id,number) values (%L,%L,99)$f$, u1, c9), 'no pertenece');
  perform t.check('Q13 un error no deja el presupuesto a medias (sigue con su ítem original)', (select count(*) from quote_items where quote_id = q2 and description = 'Otro') = 1);
  perform t.su();

  perform t.as_user(u2);
  perform t.err('Q14 otro profesional no puede editar presupuestos ajenos', format($f$select save_quote(gen_random_uuid(), %L, null, null, '[]'::jsonb)$f$, q2), 'No encontramos');
  perform t.err('Q15 ni usar conceptos propios ajenos', format($f$select save_quote(gen_random_uuid(), null, null, null, jsonb_build_array(jsonb_build_object('catalog_item_id', %L, 'description','x','quantity',1,'unit_price',1)))$f$, ci2), 'no pertenece');
  perform t.check('Q16 no ve presupuestos ajenos', (select count(*) from quotes where user_id = u1) = 0 and (select count(*) from quote_items) = 0);
  perform t.su();

  -- ===== integridad histórica =====
  perform t.as_user(u1);
  update catalog_items set unit_price = 9999, name = 'Flete caro' where id = ci2;
  r := save_quote(gen_random_uuid(), null, c1, null, jsonb_build_array(jsonb_build_object('catalog_item_id', ci2, 'description','Flete caro','quantity',1,'unit_price',9999)));
  q1 := (r->>'id')::uuid;
  perform t.su();
  perform t.check('H1 el presupuesto nuevo toma el precio actual', (select total from quotes where id = q1) = 9999);
  update catalog_items set unit_price = 1, name = 'Otro nombre' where id = ci2;
  perform t.check('H2 cambiar el catálogo después no altera el presupuesto emitido', (select unit_price = 9999 and description = 'Flete caro' and subtotal = 9999 from quote_items where quote_id = q1) and (select total from quotes where id = q1) = 9999);

  update quotes set status = 'sent' where id = q1;
  perform t.as_user(u1);
  perform t.err('H3 un presupuesto enviado no se puede re-guardar', format($f$select save_quote(gen_random_uuid(), %L, null, null, '[]'::jsonb)$f$, q1), 'borrador');
  perform t.err('H4 ni se tocan sus ítems directamente (update)', format($f$update quote_items set unit_price = 1 where quote_id = %L$f$, q1), 'borrador');
  perform t.err('H5 ni se agregan ítems', format($f$insert into quote_items(quote_id,description,quantity,unit_price,subtotal) values (%L,'x',1,1,1)$f$, q1), 'borrador');
  perform t.err('H6 ni se borran ítems sueltos', format($f$delete from quote_items where quote_id = %L$f$, q1), 'borrador');
  delete from quotes where id = q1;
  perform t.su();
  perform t.check('H7 borrar el presupuesto completo sí funciona (cascada)', not exists (select 1 from quotes where id = q1) and not exists (select 1 from quote_items where quote_id = q1));

  -- ===== agenda =====
  perform t.as_user(u1);
  r := save_quote(gen_random_uuid(), null, c1, null, jsonb_build_array(jsonb_build_object('description','Obra','quantity',1,'unit_price',100)));
  q1 := (r->>'id')::uuid;
  perform t.su();
  update quotes set status = 'accepted' where id = q1;
  insert into client_jobs(user_id,customer_id,quote_id,description,status) values (u1,c1,q1,'Trabajo','pending') returning id into j;
  perform t.as_user(u1);
  perform t.err('A1 no se cambia el cliente de un presupuesto con trabajo activo', format($f$update quotes set customer_id = %L where id = %L$f$, c2, q1), 'trabajo en la agenda');
  perform t.su();

  -- ===== sello de sincronización =====
  perform t.as_user(u1);
  stamp1 := my_sync_stamp();
  insert into catalog_items(user_id,name,unit_price) values (u1,'Nuevo concepto',5);
  stamp2 := my_sync_stamp();
  perform t.check('S1 el sello cambia al crear un concepto propio', stamp1->>'own_catalog' <> stamp2->>'own_catalog');
  perform t.su();
  perform t.as_user(u2);
  perform t.check('S2 el sello de otro usuario no refleja datos ajenos', (my_sync_stamp()->>'own_catalog') like '0:%');
  perform t.su();

  -- ===== permisos =====
  execute 'set local role anon';
  perform t.err('P1 anon no puede ejecutar save_quote', $f$select save_quote(gen_random_uuid(), null, null, null, '[]'::jsonb)$f$, 'permission denied');
  perform t.err('P2 anon no puede leer catalog_items', $f$select * from catalog_items$f$, 'permission denied');
  perform t.su();
end $$;

\echo ===== RESULTADOS =====
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '   -> ' || coalesce(detail,'') end from t.results order by n;
select 'TOTAL: ' || count(*) || '  PASS: ' || count(*) filter (where ok) || '  FAIL: ' || count(*) filter (where not ok) from t.results;

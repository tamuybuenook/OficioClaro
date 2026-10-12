-- Pruebas de aceptación SQL (Postgres real, RLS real, roles simulados). Se corre sobre una DB de PRUEBAS aislada.
\set ON_ERROR_STOP on
\pset tuples_only on
create schema if not exists t;
grant usage on schema t to anon, authenticated;
create table if not exists t.results(n serial, name text, ok boolean, detail text);
grant all on t.results to anon, authenticated; grant usage on all sequences in schema t to anon, authenticated;

create or replace function t.check(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin insert into t.results(name, ok, detail) values (p_name, coalesce(p_ok,false), p_detail); end $$;

-- Ejecuta sql y espera error cuyo mensaje contenga el patrón.
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
create or replace function t.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
end $$;
create or replace function t.su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

-- ---------- datos aislados ----------
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@t'),
 ('00000000-0000-0000-0000-0000000000b1','u1@t'),
 ('00000000-0000-0000-0000-0000000000b2','u2@t');
update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000a1';

-- =====================================================
-- 1-2) UT maestra por fecha e historial con vigencias
-- =====================================================
do $$ begin
  insert into master_ut_history(value, valid_from, valid_to, note) values (30000,'2026-08-01','2026-09-21','previo');
  insert into master_ut_history(value, valid_from, note) values (39000,'2026-09-21','vigente');
  perform t.check('1a UT maestra 20/09 = 30000', get_master_ut_at('2026-09-20')=30000);
  perform t.check('1b UT maestra 21/09 = 39000 (límite de vigencia)', get_master_ut_at('2026-09-21')=39000);
  perform t.check('1c UT maestra 01/10 = 39000', get_master_ut_at('2026-10-01')=39000);
  perform t.check('1d UT maestra antes del primer registro = null', get_master_ut_at('2026-07-01') is null);

  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  perform set_master_ut_value(41000,'cambio 1');
  perform set_master_ut_value(42000,'cambio 2 mismo día');
  perform t.su();
  perform t.check('2a historial conserva registros anteriores', (select count(*) from master_ut_history where value in (30000,39000))=2);
  perform t.check('2b registro 39000 quedó cerrado, no borrado', (select valid_to from master_ut_history where value=39000) = current_date);
  perform t.check('2c cambio del mismo día: prevalece el último (42000)', get_master_ut_at(current_date)=42000);
  perform t.check('2d consulta a fecha previa sigue dando 39000', get_master_ut_at('2026-10-01')=39000);
  perform t.check('2e un solo registro abierto', (select count(*) from master_ut_history where valid_to is null)=1);
  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  perform t.err('2f usuario común no puede cambiar UT maestra', 'select set_master_ut_value(1,''x'')', 'administrador');
  perform t.su();
  perform t.as_anon();
  perform t.err('2g anon no puede ejecutar set_master_ut_value', 'select set_master_ut_value(1,''x'')', 'permission denied');
  perform t.su();
end $$;

-- =====================================================
-- 3-4) UT personal por usuario y aislamiento
-- =====================================================
do $$ declare c int; begin
  perform t.as_user('00000000-0000-0000-0000-0000000000b1'); perform set_ut_value('00000000-0000-0000-0000-0000000000b1', 50000, 'u1'); perform t.su();
  perform t.as_user('00000000-0000-0000-0000-0000000000b2'); perform set_ut_value('00000000-0000-0000-0000-0000000000b2', 60000, 'u2'); perform t.su();
  perform t.check('3a UT de u1 = 50000', (select unit_value from profiles where id='00000000-0000-0000-0000-0000000000b1')=50000);
  perform t.check('3b UT de u2 = 60000 (sin interferencia)', (select unit_value from profiles where id='00000000-0000-0000-0000-0000000000b2')=60000);
  perform t.check('3c UT maestra no fue alterada por UT personal', get_master_ut_at(current_date)=42000);
  perform t.check('3d get_ut_at por usuario', get_ut_at('00000000-0000-0000-0000-0000000000b1',current_date)=50000 and get_ut_at('00000000-0000-0000-0000-0000000000b2',current_date)=60000);

  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  perform t.err('3e u1 no puede cambiar la UT de u2', 'select set_ut_value(''00000000-0000-0000-0000-0000000000b2'', 1)', 'No autorizado');
  perform t.err('3f u1 no puede ascenderse a admin', 'update profiles set role=''admin'' where id=''00000000-0000-0000-0000-0000000000b1''', 'rol');
  perform t.err('3g u1 no puede escribir unit_value directo (sin historial)', 'update profiles set unit_value=1 where id=''00000000-0000-0000-0000-0000000000b1''', 'UT');
  select count(*) into c from profiles; perform t.check('4a u1 ve solo su perfil', c=1, c::text);
  update profiles set full_name='hack' where id='00000000-0000-0000-0000-0000000000b2'; get diagnostics c = row_count;
  perform t.check('4b u1 no modifica el perfil de u2', c=0, c::text);
  perform t.su();
  perform t.check('4c nombre de u2 intacto', (select full_name from profiles where id='00000000-0000-0000-0000-0000000000b2') is distinct from 'hack');
end $$;

do $$ declare c int; sid uuid; begin
  select id into sid from services limit 1;
  insert into user_price_items(user_id, service_id, custom_price) values ('00000000-0000-0000-0000-0000000000b2', sid, 77777);
  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into c from user_price_items; perform t.check('4d u1 no ve precios de u2', c=0, c::text);
  update user_price_items set custom_price=1 where user_id='00000000-0000-0000-0000-0000000000b2'; get diagnostics c=row_count;
  perform t.check('4e u1 no modifica precios de u2', c=0, c::text);
  delete from user_price_items where user_id='00000000-0000-0000-0000-0000000000b2'; get diagnostics c=row_count;
  perform t.check('4f u1 no borra precios de u2', c=0, c::text);
  perform t.err('4g u1 no inserta con user_id de u2', format('insert into user_price_items(user_id,service_id,custom_price) values (''00000000-0000-0000-0000-0000000000b2'',%L,5)', sid), 'row-level security');
  -- UT propia de una tarea sin precio manual (antes fallaba por NOT NULL)
  insert into user_price_items(user_id, service_id, custom_ut_coefficient) values ('00000000-0000-0000-0000-0000000000b1', sid, 3.2);
  perform t.check('4h u1 guarda UT propia por tarea sin custom_price', (select custom_ut_coefficient from user_price_items)=3.2);
  perform t.su();
  perform t.check('4i precio de u2 intacto', (select custom_price from user_price_items where user_id='00000000-0000-0000-0000-0000000000b2')=77777);
  perform t.err('4j fila sin precio ni UT es inválida', format('insert into user_price_items(user_id,service_id) values (''00000000-0000-0000-0000-0000000000b2'',%L)', (select id from services offset 1 limit 1)), 'user_price_items_has_value');
end $$;

-- =====================================================
-- 5-7) Versiones, generación desde UT, validación, publicación
-- =====================================================
do $$ declare tid uuid; cid uuid; plid uuid; r jsonb; vid uuid; n int; ref numeric; begin
  insert into trades(name,slug) values ('T-Test','t-test') returning id into tid;
  insert into categories(trade_id,name) values (tid,'Cat') returning id into cid;
  insert into services(category_id,name,ut_coefficient) values
    (cid,'S10',10.000),(cid,'S283',2.830),(cid,'S34',3.400),(cid,'S38',3.800),(cid,'S-sinUT',null);
  insert into price_lists(trade_id,name) values (tid,'T-Test lista') returning id into plid;

  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  perform t.err('6a usuario común no crea versiones', format('select create_price_list_version(%L,''Octubre 2026'',''2026-10-01'')', plid), 'administrador');
  perform t.su();

  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  r := create_price_list_version(plid,'Octubre 2026','2026-10-01'); vid := (r->>'id')::uuid;
  perform t.check('5a crea versión draft', (r->>'created')::boolean and (r->>'status')='draft');
  r := create_price_list_version(plid,'Octubre 2026','2026-10-01');
  perform t.check('5b crear versión es idempotente (no duplica)', not (r->>'created')::boolean and (r->>'id')::uuid=vid);
  perform t.err('5c mismo rótulo con otra fecha falla', format('select create_price_list_version(%L,''Octubre 2026'',''2026-10-15'')', plid), 'otra fecha');
  perform t.err('5d rótulo vacío falla', format('select create_price_list_version(%L,'' '',''2026-10-15'')', plid), 'obligatorio');

  perform t.err('7a no publica versión sin ítems', format('select publish_price_list_version(%L)', vid), 'no tiene precios');
  perform t.err('7b UPDATE directo a published también valida', format('update price_list_versions set status=''published'' where id=%L', vid), 'no tiene precios');

  r := generate_version_items_from_ut(vid);
  perform t.check('5e generación usa UT maestra a la fecha de vigencia (39000)', (r->>'reference_ut_value')::numeric=39000, r::text);
  perform t.check('5f insertó 4 servicios con UT (sin el servicio sin UT)', (r->>'inserted')::int=4 and (r->>'services_without_ut')::int=1, r::text);
  perform t.check('5g reference_ut_value guardado en la versión', (select reference_ut_value from price_list_versions where id=vid)=39000);
  perform t.check('6b precio = UT × 39000 (10 -> 390000)', (select base_price from price_items pi join services s on s.id=pi.service_id where pi.price_list_version_id=vid and s.name='S10')=390000);
  perform t.check('6c precio 2,830 -> 110370', (select base_price from price_items pi join services s on s.id=pi.service_id where pi.price_list_version_id=vid and s.name='S283')=110370);
  perform t.check('6d precio 3,400 -> 132600', (select base_price from price_items pi join services s on s.id=pi.service_id where pi.price_list_version_id=vid and s.name='S34')=132600);
  perform t.check('6e sin duplicados de servicio', (select count(*)=count(distinct service_id) from price_items where price_list_version_id=vid));

  r := generate_version_items_from_ut(vid);
  perform t.check('6f segunda generación es idempotente', (r->>'inserted')::int=0 and (r->>'updated')::int=0 and (r->>'unchanged')::int=4, r::text);
  perform t.check('6g sigue sin duplicados', (select count(*) from price_items where price_list_version_id=vid)=4);

  -- el draft se puede revisar/editar (antes el UPDATE se descartaba en silencio)
  update price_items set base_price=86445 where price_list_version_id=vid and service_id=(select id from services where name='S38');
  perform t.check('6h UPDATE sobre ítem draft ahora persiste', (select base_price from price_items where price_list_version_id=vid and service_id=(select id from services where name='S38'))=86445);
  r := validate_price_list_version(vid);
  perform t.check('6i validación advierte precio distinto de UT×ref (no lo sobrescribe)', r::text ilike '%difieren de UT%' and jsonb_array_length(r->'errors')=0, r::text);
  r := generate_version_items_from_ut(vid);
  perform t.check('6j regenerar corrige el desvío (updated=1)', (r->>'updated')::int=1 and (select base_price from price_items where price_list_version_id=vid and service_id=(select id from services where name='S38'))=148200, r::text);
  perform t.su();

  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from price_list_versions where status='draft'; perform t.check('8a usuario común no ve drafts', n=0, n::text);
  perform t.err('7c usuario común no publica', format('select publish_price_list_version(%L)', vid), 'administrador');
  perform t.su();

  -- publicar
  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  r := publish_price_list_version(vid);
  perform t.check('7d publicación exitosa', (select status from price_list_versions where id=vid)='published');
  perform t.check('7e conserva vigencia y UT de referencia', (select effective_date='2026-10-01' and reference_ut_value=39000 and published_at is not null from price_list_versions where id=vid));
  perform t.err('10a versión publicada no se modifica (UPDATE)', format('update price_list_versions set version_label=''x'' where id=%L', vid), 'publicada');
  perform t.err('10b versión publicada no se borra', format('delete from price_list_versions where id=%L', vid), 'publicada');
  perform t.err('10c ítem publicado no se modifica', format('update price_items set base_price=1 where price_list_version_id=%L', vid), 'publicada');
  perform t.err('10d ítem publicado no se borra', format('delete from price_items where price_list_version_id=%L', vid), 'publicada');
  perform t.err('10e no se agregan ítems a versión publicada', format('insert into price_items(price_list_version_id,service_id,base_price) values (%L,%L,5)', vid, (select id from services where name='S-sinUT')), 'publicada');
  perform t.err('10f tampoco el admin puede volver a draft', format('update price_list_versions set status=''draft'' where id=%L', vid), 'publicada');
  perform t.su();
  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  perform t.check('10g usuarios sí ven la versión publicada', (select count(*) from price_list_versions where id=vid)=1);
  delete from price_items where price_list_version_id=vid; get diagnostics n = row_count;
  perform t.check('10h usuario común no borra ítems publicados (RLS: 0 filas)', n=0, n::text);
  perform t.su();

  -- misma vigencia publicada dos veces
  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  r := create_price_list_version(plid,'Octubre 2026 bis','2026-10-01');
  insert into price_items(price_list_version_id,service_id,base_price) select (r->>'id')::uuid, id, 1000 from services where name='S10';
  perform t.err('7f no publica dos versiones con la misma vigencia', format('select publish_price_list_version(%L)', (r->>'id')::uuid), 'misma fecha');
  perform t.su();
end $$;

-- =====================================================
-- 11-13) IPC maestro
-- =====================================================
do $$ declare ipc1 uuid; ipc2 uuid; r jsonb; before_n int; plid uuid; base uuid; newv uuid; cnt int; begin
  insert into ipc_indexes(year,month,value,published_date) values (2026,9,2.5,'2026-10-10') returning id into ipc1;
  select pl.id into plid from price_lists pl join trades t on t.id=pl.trade_id where t.name='T-Test';
  select id into base from price_list_versions where price_list_id=plid and version_label='Octubre 2026';

  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  perform t.err('11a usuario común no aplica IPC', format('select apply_ipc_update(%L,''2026-11-01'',''Noviembre 2026'')', ipc1), 'administrador');
  perform t.su();
  perform t.as_anon();
  perform t.err('11b anon no aplica IPC', format('select apply_ipc_update(%L,''2026-11-01'',''Noviembre 2026'')', ipc1), 'permission denied');
  perform t.su();

  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  r := apply_ipc_update(ipc1,'2026-11-01','Noviembre 2026');
  perform t.su();
  select id into newv from price_list_versions where price_list_id=plid and version_label='Noviembre 2026';
  perform t.check('11c crea versión draft con source_ipc_id', (select status='draft' and source_ipc_id=ipc1 and effective_date='2026-11-01' from price_list_versions where id=newv), r::text);
  perform t.check('11d importes = anterior × 1,025 redondeado a 2 decimales', (select count(*)=4 and bool_and(n.base_price = round(o.base_price*1.025,2)) from price_items n join price_items o on o.service_id=n.service_id and o.price_list_version_id=base where n.price_list_version_id=newv));
  perform t.check('11e S10: 390000 -> 399750', (select n.base_price from price_items n join services s on s.id=n.service_id where n.price_list_version_id=newv and s.name='S10')=399750);
  perform t.check('11f versión anterior intacta y publicada', (select status='published' from price_list_versions where id=base) and (select base_price from price_items pi join services s on s.id=pi.service_id where pi.price_list_version_id=base and s.name='S10')=390000);
  perform t.check('11g IPC marcado aplicado', (select status from ipc_indexes where id=ipc1)='applied');
  perform t.check('11h reference_ut_value NO se inventa en versión por IPC', (select reference_ut_value is null from price_list_versions where id=newv));
  perform t.check('11i seed Calefón: 85000 -> 87125', (select n.base_price from price_items n join services s on s.id=n.service_id join price_list_versions v on v.id=n.price_list_version_id where s.name='Instalación de calefón' and v.version_label='Noviembre 2026')=87125);
  perform t.check('11j informa listas creadas', jsonb_array_length(r->'created')>=1, r::text);

  select count(*) into before_n from price_list_versions;
  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  perform t.err('12a segundo intento del mismo IPC falla', format('select apply_ipc_update(%L,''2026-11-01'',''Noviembre 2026'')', ipc1), 'ya fue aplicado');
  perform t.err('12b generar desde UT sobre versión de IPC está bloqueado', format('select generate_version_items_from_ut(%L)', newv), 'IPC');
  perform t.su();
  perform t.check('12c no se duplicaron versiones', (select count(*) from price_list_versions)=before_n);

  -- 13) operación sin efecto no deja el IPC marcado como aplicado ni versiones parciales
  insert into ipc_indexes(year,month,value,published_date) values (2026,10,1.0,'2026-10-11') returning id into ipc2;
  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  perform t.err('13a IPC sin listas actualizables falla explicando motivos', format('select apply_ipc_update(%L,''2026-11-01'',''Noviembre 2026'')', ipc2), 'No se generó ninguna versión');
  perform t.su();
  perform t.check('13b IPC sigue pendiente', (select status from ipc_indexes where id=ipc2)='pending');
  perform t.check('13c sin versiones parciales', (select count(*) from price_list_versions)=before_n and (select count(*) from price_list_versions where source_ipc_id=ipc2)=0);

  -- las versiones por IPC se revisan y publican por el mismo flujo
  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  perform publish_price_list_version(newv);
  perform t.su();
  perform t.check('11k versión por IPC publicable tras revisión', (select status from price_list_versions where id=newv)='published');
end $$;

-- =====================================================
-- 3/9) IPC personal: atómico, idempotente, aislado
-- =====================================================
do $$ declare ipc uuid; sid uuid; r jsonb; begin
  select id into ipc from ipc_indexes where value=2.5;
  select id into sid from services where name='S10';
  insert into user_price_items(user_id,service_id,custom_price) values ('00000000-0000-0000-0000-0000000000b1', sid, 100000);
  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  r := apply_my_ipc_update(ipc);
  perform t.err('9a no se puede aplicar dos veces el mismo IPC', format('select apply_my_ipc_update(%L)', ipc), 'Ya aplicaste');
  perform t.su();
  perform t.check('9b UT personal 50000 -> 51250', (select unit_value from profiles where id='00000000-0000-0000-0000-0000000000b1')=51250, r::text);
  perform t.check('9c precio manual 100000 -> 102500', (select custom_price from user_price_items where user_id='00000000-0000-0000-0000-0000000000b1' and service_id=sid)=102500);
  perform t.check('9d historial personal conserva el valor anterior', (select count(*) from ut_history where user_id='00000000-0000-0000-0000-0000000000b1')>=2 and get_ut_at('00000000-0000-0000-0000-0000000000b1','2020-01-01') is null);
  perform t.check('9e u2 no fue afectado (UT y precio)', (select unit_value from profiles where id='00000000-0000-0000-0000-0000000000b2')=60000 and (select custom_price from user_price_items where user_id='00000000-0000-0000-0000-0000000000b2' and custom_price=77777) is not null);
  perform t.check('9f la UT maestra no cambió por el IPC personal', get_master_ut_at(current_date)=42000);
end $$;

-- =====================================================
-- Carga masiva atómica
-- =====================================================
do $$ declare tid uuid; r jsonb; begin
  insert into trades(name,slug) values ('T-Bulk','t-bulk') returning id into tid;
  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  perform t.err('14a fila inválida aborta toda la carga', format('select bulk_upsert_catalog(%L, %L::jsonb)', tid, '[{"category":"A","name":"X","ut":2},{"category":"A","name":"Y","ut":0}]'), 'UT inválida');
  perform t.su();
  perform t.check('14b sin datos parciales tras el error', (select count(*) from categories where trade_id=tid)=0);
  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  r := bulk_upsert_catalog(tid, '[{"category":"A","name":"X","ut":2},{"category":"A","name":"Y","ut":3.5}]'::jsonb);
  perform t.check('14c carga válida crea 2', (r->>'created')::int=2, r::text);
  r := bulk_upsert_catalog(tid, '[{"category":"A","name":"X","ut":2},{"category":"A","name":"Y","ut":3.5}]'::jsonb);
  perform t.check('14d repetir es idempotente', (r->>'created')::int=0 and (r->>'updated')::int=0, r::text);
  perform t.err('14e nombre repetido en otra categoría se rechaza', format('select bulk_upsert_catalog(%L, %L::jsonb)', tid, '[{"category":"B","name":"X","ut":2}]'), 'otra categoría');
  perform t.su();
  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  perform t.err('14f usuario común no carga catálogo', format('select bulk_upsert_catalog(%L, %L::jsonb)', tid, '[{"category":"A","name":"Z","ut":2}]'), 'administrador');
  perform t.su();
end $$;

-- =====================================================
-- Descartar borradores (nunca publicados) con respaldo
-- =====================================================
do $$ declare plid uuid; d uuid; pub uuid; r jsonb; begin
  select pl.id into plid from price_lists pl join trades t on t.id=pl.trade_id where t.name='T-Test';
  select id into pub from price_list_versions where price_list_id=plid and status='published' limit 1;
  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  r := create_price_list_version(plid,'Borrador a descartar','2027-01-01'); d := (r->>'id')::uuid;
  insert into price_items(price_list_version_id,service_id,base_price) select d, id, 500 from services where name in ('S10','S34');
  perform t.err('15a no se descarta una versión publicada', format('select discard_draft_version(%L)', pub), 'borrador');
  r := discard_draft_version(d);
  perform t.su();
  perform t.check('15b borrador descartado', not exists (select 1 from price_list_versions where id=d) and (r->>'items_backed_up')::int=2, r::text);
  perform t.check('15c respaldo en auditoría con los ítems', (select jsonb_array_length(old_value->'items')=2 from audit_logs where action='discard_draft' and entity_id=d));
  perform t.check('15d versiones publicadas intactas', (select count(*) from price_list_versions where id=pub and status='published')=1);
  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  perform t.err('15e usuario común no descarta', format('select discard_draft_version(%L)', pub), 'administrador');
  perform t.su();
end $$;

-- ---------- resumen ----------
\echo ===== RESULTADOS =====
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '   -> ' || coalesce(detail,'') end from t.results order by n;
select 'TOTAL: ' || count(*) || '  PASS: ' || count(*) filter (where ok) || '  FAIL: ' || count(*) filter (where not ok) from t.results;

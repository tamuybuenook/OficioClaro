-- Pruebas de la PROPUESTA 0031 sobre una base local con migraciones 0001–0030 + la propuesta. No toca ninguna base remota.
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

insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000c1','admin@t.com'), ('00000000-0000-0000-0000-0000000000c2','ana@t.com');
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1';

do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000c1';
  ana uuid := '00000000-0000-0000-0000-0000000000c2';
  sa uuid; plan uuid; pa uuid; d1 uuid; n int;
begin
  -- CUIT: 20-12345678-6 es válido (dígito verificador 6); alterado, no.
  perform t.check('1 CUIT válido', public.billing_valid_cuit('20123456786'));
  perform t.check('2 CUIT con dígito verificador incorrecto', not public.billing_valid_cuit('20123456787'));
  perform t.check('3 CUIT con guiones, letras o largo incorrecto', not public.billing_valid_cuit('20-12345678-6') and not public.billing_valid_cuit('2012345678') and not public.billing_valid_cuit(null));

  select id into sa from subscriptions where user_id = ana;
  select id into plan from plans where name = 'Medium';
  insert into payments(subscription_id, provider, amount, status, external_id, plan_id, mp_status, applied_at) values (sa, 'mercadopago', 8000, 'reconciled', 'MP-1', plan, 'approved', now()) returning id into pa;

  -- Datos fiscales
  insert into billing_tax_profiles(user_id, legal_name, tax_id_type, tax_id, iva_condition) values (ana, 'Ana Pérez', 'CUIT', '20123456786', 'MONOTRIBUTO');
  perform t.err('4 CUIT inválido en el perfil fiscal', 'insert into billing_tax_profiles(user_id, legal_name, tax_id_type, tax_id, iva_condition) values (''00000000-0000-0000-0000-0000000000c1'', ''X'', ''CUIT'', ''20123456787'', ''MONOTRIBUTO'')', 'billing_tax_id_ck');
  perform t.err('5 consumidor final no lleva documento', 'insert into billing_tax_profiles(user_id, legal_name, tax_id_type, tax_id, iva_condition) values (''00000000-0000-0000-0000-0000000000c1'', ''X'', ''CONSUMIDOR_FINAL'', ''123'', ''CONSUMIDOR_FINAL'')', 'billing_tax_id_ck');

  -- Comprobantes
  insert into billing_documents(payment_id, user_id, payment_snapshot, receiver_snapshot, kind, doc_type, external_id, total)
  values (pa, ana, '{"external_id":"MP-1"}', '{"name":"Ana Pérez"}', 'invoice', 'FACTURA_C', 'NF-1', 8000) returning id into d1;
  perform t.check('6 un pedido de comprobante queda "requested" sin CAE', (select status = 'requested' and cae is null from billing_documents where id = d1));
  perform t.err('7 no hay dos comprobantes vivos para el mismo pago y tipo', 'insert into billing_documents(payment_id, user_id, payment_snapshot, receiver_snapshot, kind, doc_type, external_id, total) select payment_id, user_id, payment_snapshot, receiver_snapshot, kind, doc_type, ''NF-2'', total from billing_documents', 'billing_documents_one_live_per_payment_uidx');
  perform t.err('8 "issued" exige número, CAE, vencimiento y fecha', 'update billing_documents set status = ''issued'' where external_id = ''NF-1''', 'billing_documents_issued_ck');
  update billing_documents set status = 'issued', point_of_sale = 1, number = 100, cae = '12345678901234', cae_due_date = current_date + 10, issued_at = now() where id = d1;
  perform t.check('9 emitido con todos los datos', (select status = 'issued' from billing_documents where id = d1));
  perform t.err('10 un comprobante emitido es inmutable', 'update billing_documents set total = 1 where external_id = ''NF-1''', 'billing:issued_immutable');
  perform t.err('11 la numeración fiscal no se repite', 'insert into billing_documents(payment_id, user_id, payment_snapshot, receiver_snapshot, kind, doc_type, status, point_of_sale, number, cae, cae_due_date, issued_at, total, external_id) values (null, null, ''{}'', ''{}'', ''invoice'', ''FACTURA_C'', ''issued'', 1, 100, ''12345678901235'', current_date, now(), 10, ''NF-9'')', 'billing_documents_number_uidx');
  perform t.err('12 no se borra un comprobante', 'delete from billing_documents', 'billing:no_delete');
  perform t.err('13 no se trunca', 'truncate billing_documents', 'billing:no_delete');

  -- El comprobante sobrevive al borrado del pago/usuario (set null): se desactiva la guardia de pagos solo en esta prueba, como superusuario.
  perform t.check('14 FK payment_id es ON DELETE SET NULL', (select confdeltype = 'n' from pg_constraint where conrelid = 'billing_documents'::regclass and confrelid = 'payments'::regclass));
  perform t.check('15 FK user_id es ON DELETE SET NULL', (select confdeltype = 'n' from pg_constraint where conrelid = 'billing_documents'::regclass and confrelid = 'profiles'::regclass));

  -- Permisos
  perform t.as_user(ana);
  select count(*) into n from billing_documents; perform t.check('16 un usuario común no ve comprobantes', n = 0, n::text);
  select count(*) into n from billing_tax_profiles; perform t.check('17 un usuario común no ve datos fiscales', n = 0, n::text);
  perform t.err('18 un usuario no inserta comprobantes', 'insert into billing_documents(payment_snapshot, receiver_snapshot, kind, doc_type, total) values (''{}'', ''{}'', ''invoice'', ''FACTURA_C'', 1)', 'permission denied');
  perform t.as_user(adm);
  select count(*) into n from billing_documents; perform t.check('19 el admin los ve', n = 1, n::text);
  perform t.err('20 el admin tampoco escribe comprobantes desde el navegador', 'insert into billing_documents(payment_snapshot, receiver_snapshot, kind, doc_type, total) values (''{}'', ''{}'', ''invoice'', ''FACTURA_C'', 1)', 'permission denied');
  perform t.su();
end $$;

\echo ===== RESULTADOS =====
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || case when ok then '' else '   -> ' || coalesce(detail,'') end from t.results order by n;
select 'TOTAL: ' || count(*) || '  PASS: ' || count(*) filter (where ok) || '  FAIL: ' || count(*) filter (where not ok) from t.results;

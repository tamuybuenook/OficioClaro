-- 0035_catalogo_propio_y_presupuestos.sql
-- PROPUESTA: NO aplicada en ningún proyecto de Supabase. Revisar y probar en un proyecto de prueba antes.
--
-- Qué agrega (todo aditivo; no borra ni reescribe datos existentes):
--   1. catalog_items: catálogo PROPIO de cada profesional (artículos/servicios con precio unitario).
--   2. quote_items: admite conceptos propios y personalizados (service_id deja de ser obligatorio) y
--      guarda unidad y orden de la línea.
--   3. quotes: clave de idempotencia (client_request_id) y validación de propiedad del cliente.
--   4. Un presupuesto que ya no es borrador no admite cambios en sus ítems (integridad histórica).
--   5. save_quote(): guarda presupuesto + ítems en UNA transacción, con numeración sin carreras,
--      cálculo de subtotales/total en la base y reintentos idempotentes.
--   6. my_sync_stamp(): "sello" liviano para que cada dispositivo sepa si su caché local quedó vieja.
--
-- Depende de 0020 (quotes.status/number) y de 0022 (quote_items.description, client_jobs.quote_id).
-- No hay tablas de organizaciones en el esquema: la propiedad es por usuario (user_id).

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quote_items' and column_name = 'description')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_jobs' and column_name = 'quote_id') then
    raise exception '0035 requiere que 0020 y 0022 estén aplicadas (quote_items.description y client_jobs.quote_id).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Catálogo propio del profesional
-- ---------------------------------------------------------------------------
create table catalog_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  category text check (category is null or char_length(category) <= 60),
  unit_label text not null default 'Unidad' check (char_length(btrim(unit_label)) between 1 and 20),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index catalog_items_owner_idx on catalog_items (user_id, is_active, name);
create index catalog_items_name_trgm_idx on catalog_items using gin (name gin_trgm_ops);
-- Evita duplicados por doble clic o reintento: un solo concepto activo con el mismo nombre por profesional.
create unique index catalog_items_unique_active_name
  on catalog_items (user_id, lower(btrim(name))) where is_active;

-- La propiedad la fija la base, nunca el navegador: se ignora cualquier user_id enviado.
create or replace function catalog_items_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  new.name := btrim(new.name);
  new.unit_label := btrim(new.unit_label);
  new.updated_at := now();
  return new;
end;
$$;
create trigger trg_catalog_items_guard
  before insert or update on catalog_items
  for each row execute function catalog_items_guard();

alter table catalog_items enable row level security;
-- Solo el dueño. A propósito sin excepción para admin: el catálogo propio es privado.
create policy catalog_items_own on catalog_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No se ofrece DELETE: se desactiva (is_active = false) para no romper el historial.
revoke delete on catalog_items from authenticated;
grant select, insert, update on catalog_items to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ítems de presupuesto: conceptos propios y personalizados
-- ---------------------------------------------------------------------------
alter table quote_items alter column service_id drop not null;
alter table quote_items add column catalog_item_id uuid references catalog_items(id) on delete set null;
alter table quote_items add column unit_label text;
alter table quote_items add column position integer not null default 0;
-- Todo ítem tiene un texto histórico: o viene de un servicio (la fila vieja ya tiene service_id) o lleva descripción.
alter table quote_items add constraint quote_items_concept_chk
  check (service_id is not null or (description is not null and char_length(btrim(description)) > 0));
create index quote_items_quote_idx on quote_items (quote_id, position);

-- ---------------------------------------------------------------------------
-- 3. Presupuestos: idempotencia y propiedad del cliente
-- ---------------------------------------------------------------------------
alter table quotes add column client_request_id uuid;
create unique index quotes_request_uidx on quotes (user_id, client_request_id) where client_request_id is not null;

create or replace function quotes_guard()
returns trigger language plpgsql as $$
begin
  if new.customer_id is not null and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) then
    if not exists (select 1 from customers where id = new.customer_id and user_id = new.user_id) then
      raise exception 'El cliente no pertenece a este profesional.' using errcode = 'P0001';
    end if;
  end if;
  -- Si ya hay un trabajo activo en la agenda, cambiar el cliente los dejaría desalineados.
  if tg_op = 'UPDATE' and new.customer_id is distinct from old.customer_id
     and exists (select 1 from client_jobs where quote_id = new.id and status <> 'cancelled') then
    raise exception 'Este presupuesto ya tiene un trabajo en la agenda: no se puede cambiar el cliente.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_quotes_guard
  before insert or update of customer_id on quotes
  for each row execute function quotes_guard();

-- ---------------------------------------------------------------------------
-- 4. Un presupuesto enviado/aceptado/rechazado no cambia sus ítems
-- ---------------------------------------------------------------------------
-- (Si se borra el presupuesto completo, el padre ya no existe cuando se borran sus ítems en cascada y se permite.)
create or replace function quote_items_guard()
returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from quotes where id = coalesce(new.quote_id, old.quote_id);
  if found and v_status <> 'draft' then
    raise exception 'El presupuesto ya no es un borrador: no se pueden modificar sus ítems.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_quote_items_guard
  before insert or update or delete on quote_items
  for each row execute function quote_items_guard();

-- ---------------------------------------------------------------------------
-- 5. save_quote(): guardado atómico, idempotente y con totales calculados en la base
-- ---------------------------------------------------------------------------
-- p_items: [{service_id?, catalog_item_id?, description, quantity, unit_price, unit_label?}, ...]
-- SECURITY INVOKER: se aplican las políticas RLS del usuario que llama.
create or replace function save_quote(
  p_request_id uuid, p_quote_id uuid, p_customer_id uuid, p_notes text, p_items jsonb
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_q quotes%rowtype;
  v_created boolean := false;
  v_total numeric := 0;
  v_sub numeric;
  v_desc text;
  v_qty numeric;
  v_price numeric;
  rec record;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode = '28000'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Los ítems del presupuesto no son válidos.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Un presupuesto admite hasta 200 líneas.' using errcode = 'P0001';
  end if;
  if p_customer_id is not null and not exists (select 1 from customers where id = p_customer_id and user_id = v_uid) then
    raise exception 'El cliente no pertenece a este profesional.' using errcode = 'P0001';
  end if;

  -- Serializa por profesional: numeración correlativa sin repetidos y un único alta por request_id.
  perform pg_advisory_xact_lock(hashtextextended('save_quote:' || v_uid::text, 0));

  if p_quote_id is not null then
    select * into v_q from quotes where id = p_quote_id and user_id = v_uid for update;
    if not found then raise exception 'No encontramos ese presupuesto.' using errcode = 'P0001'; end if;
  elsif p_request_id is not null then
    select * into v_q from quotes where user_id = v_uid and client_request_id = p_request_id for update;
  end if;

  if v_q.id is null then
    insert into quotes (user_id, customer_id, total, number, status, notes, client_request_id)
    values (v_uid, p_customer_id, 0,
            (select coalesce(max(number), 0) + 1 from quotes where user_id = v_uid),
            'draft', nullif(btrim(p_notes), ''), p_request_id)
    returning * into v_q;
    v_created := true;
  else
    if v_q.status <> 'draft' then
      raise exception 'El presupuesto ya no es un borrador: no se puede modificar.' using errcode = 'P0001';
    end if;
    update quotes set customer_id = p_customer_id, notes = nullif(btrim(p_notes), '') where id = v_q.id;
  end if;

  delete from quote_items where quote_id = v_q.id;

  for rec in
    select (e.elem->>'service_id')::uuid as service_id,
           (e.elem->>'catalog_item_id')::uuid as catalog_item_id,
           e.elem->>'description' as description,
           (e.elem->>'quantity')::numeric as quantity,
           (e.elem->>'unit_price')::numeric as unit_price,
           e.elem->>'unit_label' as unit_label,
           e.ord::int as ord
    from jsonb_array_elements(p_items) with ordinality as e(elem, ord)
    order by e.ord
  loop
    v_desc := nullif(btrim(rec.description), '');
    if v_desc is null and rec.service_id is not null then
      select name into v_desc from services where id = rec.service_id;
    end if;
    if v_desc is null or char_length(v_desc) > 200 then
      raise exception 'Cada línea necesita una descripción de hasta 200 caracteres.' using errcode = 'P0001';
    end if;
    v_qty := round(coalesce(rec.quantity, 0), 2);
    v_price := round(coalesce(rec.unit_price, -1), 2);
    if v_qty <= 0 or v_qty > 99999999 then
      raise exception 'La cantidad de "%" no es válida.', v_desc using errcode = 'P0001';
    end if;
    if v_price < 0 or v_price > 9999999999.99 then
      raise exception 'El precio de "%" no es válido.', v_desc using errcode = 'P0001';
    end if;
    if rec.service_id is not null and not exists (select 1 from services where id = rec.service_id) then
      raise exception 'Uno de los servicios ya no existe.' using errcode = 'P0001';
    end if;
    if rec.catalog_item_id is not null and not exists (select 1 from catalog_items where id = rec.catalog_item_id and user_id = v_uid) then
      raise exception 'Uno de los conceptos no pertenece a este profesional.' using errcode = 'P0001';
    end if;

    v_sub := round(v_qty * v_price, 2);  -- misma regla que lib/money.ts (mitad hacia afuera de cero)
    v_total := v_total + v_sub;
    insert into quote_items (quote_id, service_id, catalog_item_id, description, unit_label, quantity, unit_price, subtotal, position)
    values (v_q.id, rec.service_id, rec.catalog_item_id, v_desc, nullif(btrim(rec.unit_label), ''), v_qty, v_price, v_sub, rec.ord);
  end loop;

  update quotes set total = v_total where id = v_q.id;
  return jsonb_build_object('id', v_q.id, 'number', v_q.number, 'total', v_total, 'created', v_created);
end;
$$;
revoke all on function save_quote(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function save_quote(uuid, uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Sello de sincronización para la caché local de cada dispositivo
-- ---------------------------------------------------------------------------
-- Solo contiene contadores y fechas del propio usuario (nada sensible). La caché lo usa únicamente
-- para decidir si vuelve a pedir datos; NUNCA para autorizar nada.
create or replace function my_sync_stamp()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'own_catalog', (select count(*)::text || ':' || coalesce(max(updated_at)::text, '') from catalog_items where user_id = auth.uid()),
    'own_prices',  (select count(*)::text || ':' || coalesce(max(updated_at)::text, '') from user_price_items where user_id = auth.uid()),
    'trades',      (select count(*)::text || ':' || coalesce(max(created_at)::text, '') from user_trades where user_id = auth.uid()),
    'ut',          (select unit_value::text from profiles where id = auth.uid()),
    'master',      (select count(*)::text || ':' || coalesce(max(published_at)::text, '') from price_list_versions where status = 'published')
                   || ':' || (select count(*)::text from services)
  );
$$;
revoke all on function my_sync_stamp() from public, anon;
grant execute on function my_sync_stamp() to authenticated;

-- ---------------------------------------------------------------------------
-- NOTAS PARA QUIEN AUTORICE LA MIGRACIÓN
-- * Cambio de regla comercial (identificado): los ítems de un presupuesto enviado/aceptado/rechazado
--   ya no se pueden agregar, quitar ni editar. Antes la app lo permitía en cualquier estado.
--   Para corregir un presupuesto enviado hay que pasarlo de nuevo a borrador (la pantalla lo ofrece).
-- * quotes.number: NO se agregó índice único porque la numeración anterior (count + 1) puede haber
--   repetido números si se borraron presupuestos. Ver supabase/diagnostics/0035_check_quote_numbers.sql.
--   save_quote() numera con max(number) + 1 por profesional, sin repetir hacia adelante.
-- * Reversión: drop function save_quote, my_sync_stamp; drop trigger/function de quotes y quote_items;
--   drop index quotes_request_uidx; drop columns client_request_id, catalog_item_id, unit_label, position;
--   drop constraint quote_items_concept_chk; drop table catalog_items. Volver a poner NOT NULL en
--   quote_items.service_id solo es posible si no existen ítems con service_id nulo.

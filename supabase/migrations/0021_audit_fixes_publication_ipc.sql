-- 0021_audit_fixes_publication_ipc.sql
-- Corrige los problemas hallados en la auditoría. Migración incremental e idempotente
-- (no edita migraciones aplicadas; no borra ni reescribe datos históricos).
--
--  1) prevent_mutation_if_published() devolvía OLD en los UPDATE: en un BEFORE UPDATE eso
--     descarta los cambios EN SILENCIO ("UPDATE 1" sin efecto). Consecuencias reales:
--     las versiones draft nunca pasaban a 'published', reference_ut_value quedaba NULL y los
--     upserts sobre ítems draft no recalculaban precios. Ahora devuelve NEW (UPDATE) / OLD (DELETE)
--     y además bloquea INSERT de ítems en versiones publicadas.
--  2) Flujo de publicación con validación en la base (no eludible desde el cliente).
--  3) Generación de precios desde UT atómica (precios + reference_ut_value en una transacción).
--  4) apply_ipc_update: base correcta, informa listas omitidas, no marca el IPC como aplicado
--     si no generó nada.
--  5) Escalada de privilegios: un usuario podía ponerse role='admin' editando su propio perfil.
--  6) get_master_ut_at / get_ut_at devolvían el valor viejo si la UT cambiaba dos veces el mismo día.
--  7) user_price_items.custom_price NOT NULL impedía guardar solo una UT propia por tarea.
--  8) IPC personal (usuario) atómico, idempotente y calculado en la base (no con datos del cliente).
--  9) Carga masiva de catálogo atómica.

-- =========================================================
-- 0. is_admin(): SECURITY DEFINER para evitar recursión de RLS sobre profiles
--    (solo consulta el rol del propio auth.uid()).
-- =========================================================
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function is_admin() from public;
grant execute on function is_admin() to anon, authenticated;

-- =========================================================
-- 1. Trigger de inmutabilidad corregido
-- =========================================================
create or replace function prevent_mutation_if_published()
returns trigger language plpgsql as $$
declare v_status text;
begin
  if TG_TABLE_NAME = 'price_list_versions' then
    if OLD.status = 'published' then
      raise exception 'No se puede modificar una versión publicada (%).', OLD.id;
    end if;
  elsif TG_TABLE_NAME = 'price_items' then
    select status into v_status from price_list_versions where id = OLD.price_list_version_id;
    if v_status = 'published' then
      raise exception 'No se puede modificar un ítem de una versión publicada (%).', OLD.id;
    end if;
    if TG_OP = 'UPDATE' and NEW.price_list_version_id is distinct from OLD.price_list_version_id then
      select status into v_status from price_list_versions where id = NEW.price_list_version_id;
      if v_status = 'published' then
        raise exception 'No se pueden mover ítems hacia una versión publicada (%).', NEW.price_list_version_id;
      end if;
    end if;
  end if;
  -- CORRECCIÓN: NEW en UPDATE (antes OLD descartaba el cambio), OLD en DELETE.
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

create or replace function prevent_insert_into_published()
returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from price_list_versions where id = NEW.price_list_version_id;
  if v_status = 'published' then
    raise exception 'No se pueden agregar ítems a una versión publicada (%).', NEW.price_list_version_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_price_items_no_insert_published on price_items;
create trigger trg_price_items_no_insert_published
  before insert on price_items
  for each row execute function prevent_insert_into_published();

-- Backstops de integridad (NOT VALID: solo validan filas nuevas; no tocan datos existentes).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'price_items_base_price_positive') then
    alter table price_items add constraint price_items_base_price_positive check (base_price > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipc_value_range') then
    alter table ipc_indexes add constraint ipc_value_range check (value > -100 and value < 1000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plv_published_has_date') then
    alter table price_list_versions add constraint plv_published_has_date check (status = 'draft' or published_at is not null) not valid;
  end if;
end $$;

-- Una sola versión publicada por lista y fecha de vigencia (evita ambigüedad de "versión vigente").
create unique index if not exists price_list_versions_one_published_per_date
  on price_list_versions (price_list_id, effective_date) where status = 'published';

-- =========================================================
-- 2. Validación y publicación
-- =========================================================
create or replace function validate_price_list_version(p_version_id uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v record;
  v_trade_id uuid;
  v_errors text[] := '{}';
  v_warnings text[] := '{}';
  v_items int;
  v_bad_price int;
  v_foreign int;
  v_missing int;
  v_missing_ut int;
  v_mismatch int;
  v_latest_pub date;
begin
  select v2.*, pl.trade_id as trade_id into v
  from price_list_versions v2 join price_lists pl on pl.id = v2.price_list_id
  where v2.id = p_version_id;
  if not found then
    return jsonb_build_object('errors', jsonb_build_array('Versión no encontrada'), 'warnings', '[]'::jsonb, 'item_count', 0);
  end if;
  v_trade_id := v.trade_id;

  if coalesce(btrim(v.version_label), '') = '' then v_errors := v_errors || 'La versión no tiene rótulo.'; end if;
  if v.effective_date is null then v_errors := v_errors || 'La versión no tiene fecha de vigencia.'; end if;

  select count(*) into v_items from price_items where price_list_version_id = p_version_id;
  if v_items = 0 then v_errors := v_errors || 'La versión no tiene precios cargados.'; end if;

  select count(*) into v_bad_price from price_items where price_list_version_id = p_version_id and (base_price is null or base_price <= 0);
  if v_bad_price > 0 then v_errors := v_errors || format('%s ítem(s) con precio nulo o menor/igual a cero.', v_bad_price); end if;

  select count(*) into v_foreign
  from price_items pi join services s on s.id = pi.service_id join categories c on c.id = s.category_id
  where pi.price_list_version_id = p_version_id and c.trade_id <> v_trade_id;
  if v_foreign > 0 then v_errors := v_errors || format('%s ítem(s) corresponden a servicios de otro oficio.', v_foreign); end if;

  if exists (select 1 from price_list_versions o
             where o.price_list_id = v.price_list_id and o.id <> v.id and o.status = 'published' and o.effective_date = v.effective_date) then
    v_errors := v_errors || 'Ya existe otra versión publicada con la misma fecha de vigencia para esta lista.';
  end if;

  -- Advertencias (no bloquean): se informan para revisión.
  select count(*) into v_missing
  from services s join categories c on c.id = s.category_id
  where c.trade_id = v_trade_id
    and not exists (select 1 from price_items pi where pi.price_list_version_id = p_version_id and pi.service_id = s.id);
  if v_missing > 0 then v_warnings := v_warnings || format('%s servicio(s) del oficio no tienen precio en esta versión.', v_missing); end if;

  if v.source_ipc_id is null and v.reference_ut_value is null then
    v_warnings := v_warnings || 'La versión no tiene valor de UT de referencia (no fue generada desde UT).';
  end if;

  if v.reference_ut_value is not null and v.source_ipc_id is null then
    select count(*) into v_missing_ut
    from services s join categories c on c.id = s.category_id
    where c.trade_id = v_trade_id and s.ut_coefficient is not null
      and not exists (select 1 from price_items pi where pi.price_list_version_id = p_version_id and pi.service_id = s.id);
    if v_missing_ut > 0 then
      v_warnings := v_warnings || format('%s servicio(s) con UT no fueron incluidos (¿se cargaron después de generar?).', v_missing_ut);
    end if;
    select count(*) into v_mismatch
    from price_items pi join services s on s.id = pi.service_id
    where pi.price_list_version_id = p_version_id and s.ut_coefficient is not null
      and pi.base_price <> round(s.ut_coefficient * v.reference_ut_value, 2);
    if v_mismatch > 0 then
      v_warnings := v_warnings || format('%s precio(s) difieren de UT × referencia (carga manual o UT modificada luego).', v_mismatch);
    end if;
  end if;

  select max(effective_date) into v_latest_pub from price_list_versions
   where price_list_id = v.price_list_id and status = 'published' and id <> v.id;
  if v_latest_pub is not null and v.effective_date < v_latest_pub then
    v_warnings := v_warnings || format('La vigencia es anterior a la última versión publicada (%s).', v_latest_pub);
  end if;

  return jsonb_build_object(
    'errors', to_jsonb(v_errors), 'warnings', to_jsonb(v_warnings),
    'item_count', v_items, 'reference_ut_value', v.reference_ut_value,
    'effective_date', v.effective_date, 'status', v.status
  );
end;
$$;
grant execute on function validate_price_list_version(uuid) to authenticated;

-- Regla de publicación aplicada en la base: ni el cliente ni un UPDATE directo pueden saltearla.
create or replace function enforce_publish_rules()
returns trigger language plpgsql as $$
declare v_result jsonb;
begin
  if OLD.status = 'draft' and NEW.status = 'published' then
    if auth.uid() is not null and not is_admin() then
      raise exception 'Solo un administrador puede publicar una lista maestra.';
    end if;
    v_result := validate_price_list_version(OLD.id);
    if jsonb_array_length(v_result->'errors') > 0 then
      raise exception 'No se puede publicar: %', (select string_agg(e, ' ') from jsonb_array_elements_text(v_result->'errors') e);
    end if;
    NEW.published_at := coalesce(NEW.published_at, now());
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_price_list_versions_publish_rules on price_list_versions;
create trigger trg_price_list_versions_publish_rules
  before update on price_list_versions
  for each row execute function enforce_publish_rules();

create or replace function publish_price_list_version(p_version_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_result jsonb; v_rows int;
begin
  if not is_admin() then raise exception 'Solo un administrador puede publicar una lista maestra.'; end if;
  v_result := validate_price_list_version(p_version_id);
  if jsonb_array_length(v_result->'errors') > 0 then
    raise exception 'No se puede publicar: %', (select string_agg(e, ' ') from jsonb_array_elements_text(v_result->'errors') e);
  end if;
  update price_list_versions set status = 'published', published_at = now()
   where id = p_version_id and status = 'draft';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'La versión no existe o ya estaba publicada.'; end if;
  insert into audit_logs (actor_id, entity, entity_id, action, new_value)
    values (auth.uid(), 'price_list_versions', p_version_id, 'publish', v_result);
  return v_result;
end;
$$;
grant execute on function publish_price_list_version(uuid) to authenticated;

-- =========================================================
-- 3. Generación de precios desde UT (atómica) y creación idempotente de versiones
-- =========================================================
create or replace function generate_version_items_from_ut(p_version_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v record;
  v_ref numeric;
  v_inserted int := 0; v_updated int := 0; v_unchanged int := 0; v_without_ut int;
begin
  if not is_admin() then raise exception 'Solo un administrador puede generar precios.'; end if;

  select v2.*, pl.trade_id as trade_id into v
  from price_list_versions v2 join price_lists pl on pl.id = v2.price_list_id
  where v2.id = p_version_id for update of v2;
  if not found then raise exception 'Versión no encontrada'; end if;
  if v.status <> 'draft' then raise exception 'Solo se puede generar sobre una versión en borrador.'; end if;
  if v.source_ipc_id is not null then
    raise exception 'Esta versión se generó por IPC (precio anterior + %%); recalcular desde UT cambiaría la regla de actualización.';
  end if;

  v_ref := get_master_ut_at(v.effective_date);
  if v_ref is null then
    raise exception 'No hay valor de UT maestro vigente para la fecha % (cargalo primero).', v.effective_date;
  end if;

  with src as (
    select s.id as service_id, round(s.ut_coefficient * v_ref, 2) as price
    from services s join categories c on c.id = s.category_id
    where c.trade_id = v.trade_id and s.ut_coefficient is not null and s.ut_coefficient > 0
  ), classified as (
    select src.service_id, src.price, pi.id as existing_id, pi.base_price as old_price
    from src left join price_items pi on pi.price_list_version_id = p_version_id and pi.service_id = src.service_id
  ), ins as (
    insert into price_items (price_list_version_id, service_id, base_price)
    select p_version_id, service_id, price from classified where existing_id is null
    returning 1
  ), upd as (
    update price_items pi set base_price = c.price
    from classified c where pi.id = c.existing_id and pi.base_price <> c.price
    returning 1
  )
  select (select count(*) from ins), (select count(*) from upd),
         (select count(*) from classified where existing_id is not null and old_price = price)
    into v_inserted, v_updated, v_unchanged;

  select count(*) into v_without_ut from services s join categories c on c.id = s.category_id
   where c.trade_id = v.trade_id and (s.ut_coefficient is null or s.ut_coefficient <= 0);

  update price_list_versions set reference_ut_value = v_ref where id = p_version_id;

  insert into audit_logs (actor_id, entity, entity_id, action, new_value)
    values (auth.uid(), 'price_list_versions', p_version_id, 'generate_from_ut',
            jsonb_build_object('reference_ut_value', v_ref, 'inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged));

  return jsonb_build_object('reference_ut_value', v_ref, 'inserted', v_inserted, 'updated', v_updated,
                            'unchanged', v_unchanged, 'services_without_ut', v_without_ut);
end;
$$;
grant execute on function generate_version_items_from_ut(uuid) to authenticated;

-- Idempotente: si ya existe (lista, rótulo) devuelve la existente (sin duplicar); si la fecha difiere, falla.
create or replace function create_price_list_version(p_price_list_id uuid, p_label text, p_effective_date date)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_existing record; v_id uuid;
begin
  if not is_admin() then raise exception 'Solo un administrador puede crear versiones.'; end if;
  if coalesce(btrim(p_label), '') = '' then raise exception 'El rótulo de la versión es obligatorio.'; end if;
  if p_effective_date is null then raise exception 'La fecha de vigencia es obligatoria.'; end if;
  if not exists (select 1 from price_lists where id = p_price_list_id) then raise exception 'Lista no encontrada.'; end if;

  select id, status, effective_date into v_existing from price_list_versions
   where price_list_id = p_price_list_id and version_label = btrim(p_label);
  if found then
    if v_existing.effective_date <> p_effective_date then
      raise exception 'Ya existe la versión "%" con otra fecha de vigencia (%).', btrim(p_label), v_existing.effective_date;
    end if;
    return jsonb_build_object('id', v_existing.id, 'created', false, 'status', v_existing.status);
  end if;

  insert into price_list_versions (price_list_id, version_label, status, effective_date)
    values (p_price_list_id, btrim(p_label), 'draft', p_effective_date) returning id into v_id;
  insert into audit_logs (actor_id, entity, entity_id, action, new_value)
    values (auth.uid(), 'price_list_versions', v_id, 'create',
            jsonb_build_object('label', btrim(p_label), 'effective_date', p_effective_date));
  return jsonb_build_object('id', v_id, 'created', true, 'status', 'draft');
end;
$$;
grant execute on function create_price_list_version(uuid, text, date) to authenticated;

-- Descarta un BORRADOR (nunca una versión publicada: el trigger lo impediría). Guarda un respaldo
-- completo de los ítems en audit_logs, de modo que la operación sea verificable y reconstruible.
create or replace function discard_draft_version(p_version_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v record; v_snapshot jsonb;
begin
  if not is_admin() then raise exception 'Solo un administrador puede descartar borradores.'; end if;
  select * into v from price_list_versions where id = p_version_id for update;
  if not found then raise exception 'Versión no encontrada.'; end if;
  if v.status <> 'draft' then raise exception 'Solo se pueden descartar versiones en borrador.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('service_id', service_id, 'base_price', base_price)), '[]'::jsonb)
    into v_snapshot from price_items where price_list_version_id = p_version_id;

  insert into audit_logs (actor_id, entity, entity_id, action, old_value)
    values (auth.uid(), 'price_list_versions', p_version_id, 'discard_draft',
            jsonb_build_object('version', to_jsonb(v), 'items', v_snapshot));

  delete from price_items where price_list_version_id = p_version_id;
  delete from price_list_versions where id = p_version_id;
  return jsonb_build_object('discarded', p_version_id, 'items_backed_up', jsonb_array_length(v_snapshot));
end;
$$;
grant execute on function discard_draft_version(uuid) to authenticated;
revoke all on function discard_draft_version(uuid) from public, anon;

-- =========================================================
-- 4. Historiales de UT: vigencia con fin exclusivo (el cambio del mismo día prevalece)
-- =========================================================
create or replace function get_master_ut_at(p_date date default current_date)
returns numeric language sql stable as $$
  select value from master_ut_history
  where valid_from <= p_date and (valid_to is null or valid_to > p_date)
  order by valid_from desc, created_at desc
  limit 1;
$$;

create or replace function get_ut_at(p_user_id uuid, p_date date default current_date)
returns numeric language sql stable as $$
  select value from ut_history
  where user_id = p_user_id and valid_from <= p_date and (valid_to is null or valid_to > p_date)
  order by valid_from desc, created_at desc
  limit 1;
$$;

-- set_ut_value marca la escritura como confiable para el guard de profiles (ver sección 5).
create or replace function set_ut_value(p_user_id uuid, p_value numeric, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_new_id uuid;
begin
  if auth.uid() is distinct from p_user_id and not is_admin() then
    raise exception 'No autorizado';
  end if;
  if p_value is null or p_value <= 0 then
    raise exception 'El valor de UT debe ser mayor a cero';
  end if;
  perform set_config('app.trusted_write', '1', true);
  update ut_history set valid_to = current_date where user_id = p_user_id and valid_to is null;
  insert into ut_history (user_id, value, valid_from, created_by, note)
    values (p_user_id, round(p_value, 2), current_date, auth.uid(), p_note)
    returning id into v_new_id;
  update profiles set unit_value = round(p_value, 2), updated_at = now() where id = p_user_id;
  perform set_config('app.trusted_write', '0', true);
  return v_new_id;
end;
$$;

-- =========================================================
-- 5. Guard de columnas sensibles de profiles
--    (profiles_update_own permitía role='admin' y unit_value sin historial)
-- =========================================================
create or replace function guard_profile_sensitive_columns()
returns trigger language plpgsql as $$
begin
  -- auth.uid() nulo = contexto de servicio/migración (no una sesión de usuario de la app).
  if auth.uid() is not null and not is_admin() then
    if NEW.role is distinct from OLD.role then
      raise exception 'No autorizado: no podés cambiar tu rol.';
    end if;
    if (NEW.unit_value is distinct from OLD.unit_value or NEW.last_ipc_applied_id is distinct from OLD.last_ipc_applied_id)
       and coalesce(current_setting('app.trusted_write', true), '0') <> '1' then
      raise exception 'El valor de UT y el IPC aplicado solo se cambian mediante las funciones de la aplicación.';
    end if;
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_profiles_guard_sensitive on profiles;
create trigger trg_profiles_guard_sensitive
  before update on profiles
  for each row execute function guard_profile_sensitive_columns();

-- =========================================================
-- 6. apply_ipc_update (maestras): base correcta, informe de omitidas, sin estados parciales
-- =========================================================
create or replace function apply_ipc_update(p_ipc_id uuid, p_effective_date date, p_version_label text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ipc record; v_list record;
  v_base_id uuid; v_new_id uuid; v_items int;
  v_label text := btrim(coalesce(p_version_label, ''));
  v_created jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb; v_ids uuid[] := '{}';
begin
  if not is_admin() then raise exception 'Solo un administrador puede aplicar el IPC'; end if;
  if v_label = '' or p_effective_date is null then raise exception 'Rótulo y fecha de vigencia son obligatorios'; end if;

  select * into v_ipc from ipc_indexes where id = p_ipc_id for update;
  if not found then raise exception 'IPC % no encontrado', p_ipc_id; end if;
  if v_ipc.status = 'applied' then raise exception 'Este IPC ya fue aplicado'; end if;

  for v_list in
    select pl.id, pl.trade_id, t.name as trade_name from price_lists pl join trades t on t.id = pl.trade_id order by t.name
  loop
    -- una versión publicada vigente desde esa fecha o posterior hace ambigua la nueva versión
    if exists (select 1 from price_list_versions where price_list_id = v_list.id and status = 'published' and effective_date >= p_effective_date) then
      v_skipped := v_skipped || jsonb_build_object('trade', v_list.trade_name, 'reason', 'Ya existe una versión publicada con vigencia igual o posterior a la nueva.');
      continue;
    end if;

    select id into v_base_id from price_list_versions
      where price_list_id = v_list.id and status = 'published' and effective_date < p_effective_date
      order by effective_date desc limit 1;
    if v_base_id is null then
      v_skipped := v_skipped || jsonb_build_object('trade', v_list.trade_name, 'reason', 'No tiene una versión publicada anterior de la que partir.');
      continue;
    end if;

    select count(*) into v_items from price_items where price_list_version_id = v_base_id;
    if v_items = 0 then
      v_skipped := v_skipped || jsonb_build_object('trade', v_list.trade_name, 'reason', 'La versión base no tiene ítems.');
      continue;
    end if;

    if exists (select 1 from price_list_versions where price_list_id = v_list.id and version_label = v_label) then
      v_skipped := v_skipped || jsonb_build_object('trade', v_list.trade_name, 'reason', format('Ya existe una versión con el rótulo "%s".', v_label));
      continue;
    end if;

    insert into price_list_versions (price_list_id, version_label, status, effective_date, source_ipc_id)
      values (v_list.id, v_label, 'draft', p_effective_date, p_ipc_id) returning id into v_new_id;

    insert into price_items (price_list_version_id, service_id, base_price)
      select v_new_id, pi.service_id, round(pi.base_price * (1 + v_ipc.value / 100), 2)
      from price_items pi where pi.price_list_version_id = v_base_id;

    v_ids := array_append(v_ids, v_new_id);
    v_created := v_created || jsonb_build_object('trade', v_list.trade_name, 'version_id', v_new_id, 'base_version_id', v_base_id, 'items', v_items);
  end loop;

  -- Si no se generó nada, el IPC NO se marca como aplicado y se explica por qué.
  if array_length(v_ids, 1) is null then
    raise exception 'No se generó ninguna versión; el IPC sigue pendiente. Motivos: %', v_skipped::text;
  end if;

  update ipc_indexes set status = 'applied' where id = p_ipc_id;
  insert into audit_logs (actor_id, entity, entity_id, action, new_value)
    values (auth.uid(), 'ipc_indexes', p_ipc_id, 'apply',
            jsonb_build_object('versions', v_ids, 'created', v_created, 'skipped', v_skipped, 'ipc_value', v_ipc.value));

  return jsonb_build_object('versions', to_jsonb(v_ids), 'created', v_created, 'skipped', v_skipped);
end;
$$;
revoke all on function apply_ipc_update(uuid, date, text) from public, anon;
grant execute on function apply_ipc_update(uuid, date, text) to authenticated;

-- =========================================================
-- 7. Circuito personal: user_price_items y IPC del usuario
-- =========================================================
alter table user_price_items alter column custom_price drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_price_items_has_value') then
    alter table user_price_items add constraint user_price_items_has_value
      check (custom_price is not null or custom_ut_coefficient is not null) not valid;
  end if;
end $$;

-- Aplica el IPC a la UT personal y a los precios manuales del usuario que llama. Atómico e idempotente.
create or replace function apply_my_ipc_update(p_ipc_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_profile record; v_ipc record; v_last record;
  v_new_ut numeric; v_prices int;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_profile from profiles where id = v_uid for update;
  if not found then raise exception 'Perfil no encontrado'; end if;
  select * into v_ipc from ipc_indexes where id = p_ipc_id;
  if not found then raise exception 'IPC no encontrado'; end if;
  if v_profile.last_ipc_applied_id = p_ipc_id then raise exception 'Ya aplicaste este IPC a tu lista personal.'; end if;
  if v_profile.last_ipc_applied_id is not null then
    select * into v_last from ipc_indexes where id = v_profile.last_ipc_applied_id;
    if found and v_last.published_date >= v_ipc.published_date then
      raise exception 'Ya aplicaste un IPC igual o más reciente.';
    end if;
  end if;
  if v_profile.unit_value is null or v_profile.unit_value <= 0 then
    raise exception 'Primero cargá el valor de tu UT.';
  end if;

  v_new_ut := round(v_profile.unit_value * (1 + v_ipc.value / 100), 2);

  update user_price_items
     set custom_price = round(custom_price * (1 + v_ipc.value / 100), 2), updated_at = now()
   where user_id = v_uid and custom_price is not null;
  get diagnostics v_prices = row_count;

  perform set_ut_value(v_uid, v_new_ut, format('Actualización por IPC (%s%%)', v_ipc.value));
  perform set_config('app.trusted_write', '1', true);
  update profiles set last_ipc_applied_id = p_ipc_id, updated_at = now() where id = v_uid;
  perform set_config('app.trusted_write', '0', true);

  return jsonb_build_object('new_ut', v_new_ut, 'prices_updated', v_prices, 'ipc_value', v_ipc.value);
end;
$$;
revoke all on function apply_my_ipc_update(uuid) from public, anon;
grant execute on function apply_my_ipc_update(uuid) to authenticated;

-- =========================================================
-- 8. Carga masiva de catálogo (atómica; valida todo antes de escribir)
-- =========================================================
create or replace function bulk_upsert_catalog(p_trade_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r record; v_cat_id uuid; v_svc_id uuid;
  v_created int := 0; v_updated int := 0; v_cats int := 0;
  v_seen text[] := '{}'; v_key text;
begin
  if not is_admin() then raise exception 'Solo un administrador puede cargar el catálogo.'; end if;
  if not exists (select 1 from trades where id = p_trade_id) then raise exception 'Oficio no encontrado.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'No hay filas para cargar.'; end if;

  for r in select btrim(e->>'category') as category, btrim(e->>'name') as name, (e->>'ut')::numeric as ut,
                  coalesce(nullif(btrim(e->>'unit_label'), ''), 'Trabajo') as unit_label
           from jsonb_array_elements(p_rows) e
  loop
    if coalesce(r.category, '') = '' or coalesce(r.name, '') = '' then raise exception 'Fila inválida: categoría y trabajo son obligatorios.'; end if;
    if r.ut is null or r.ut <= 0 then raise exception 'UT inválida para "%".', r.name; end if;
    v_key := lower(r.name);
    if v_key = any(v_seen) then raise exception 'Trabajo repetido en la carga: "%".', r.name; end if;
    v_seen := array_append(v_seen, v_key);

    select id into v_cat_id from categories where trade_id = p_trade_id and name = r.category;
    if v_cat_id is null then
      insert into categories (trade_id, name) values (p_trade_id, r.category) returning id into v_cat_id;
      v_cats := v_cats + 1;
    end if;

    if exists (select 1 from services s join categories c on c.id = s.category_id
               where c.trade_id = p_trade_id and lower(s.name) = v_key and s.category_id <> v_cat_id) then
      raise exception '"%" ya existe en otra categoría de este oficio.', r.name;
    end if;

    select id into v_svc_id from services where category_id = v_cat_id and name = r.name;
    if v_svc_id is null then
      insert into services (category_id, name, unit_label, ut_coefficient) values (v_cat_id, r.name, r.unit_label, r.ut);
      v_created := v_created + 1;
    else
      update services set ut_coefficient = r.ut where id = v_svc_id and ut_coefficient is distinct from r.ut;
      if found then v_updated := v_updated + 1; end if;
    end if;
  end loop;

  insert into audit_logs (actor_id, entity, entity_id, action, new_value)
    values (auth.uid(), 'services', p_trade_id, 'bulk_upsert',
            jsonb_build_object('created', v_created, 'updated', v_updated, 'categories', v_cats));
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'categories_created', v_cats);
end;
$$;
grant execute on function bulk_upsert_catalog(uuid, jsonb) to authenticated;

-- =========================================================
-- 9. Permisos: las funciones sensibles no se exponen a anon
-- =========================================================
revoke all on function set_master_ut_value(numeric, text) from public, anon;
revoke all on function set_ut_value(uuid, numeric, text) from public, anon;
revoke all on function validate_price_list_version(uuid) from public, anon;
revoke all on function publish_price_list_version(uuid) from public, anon;
revoke all on function generate_version_items_from_ut(uuid) from public, anon;
revoke all on function create_price_list_version(uuid, text, date) from public, anon;
revoke all on function bulk_upsert_catalog(uuid, jsonb) from public, anon;

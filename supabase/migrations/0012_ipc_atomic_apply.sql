-- 0012_ipc_atomic_apply.sql
-- Corrige 2 problemas detectados en la auditoría (Bloque 0, sección 23):
--  1) El estado 'applied' del IPC no debe marcarse si la operación quedó parcial.
--  2) ipc_indexes.applies_to_version_id es de cardinalidad incorrecta (un IPC
--     puede originar una versión por cada oficio). La trazabilidad correcta ya
--     existe en price_list_versions.source_ipc_id (1 IPC -> N versiones); esta
--     función la usa en vez de esa columna, que queda en desuso sin borrarla.

create or replace function apply_ipc_update(p_ipc_id uuid, p_effective_date date, p_version_label text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ipc record;
  v_list record;
  v_base_version_id uuid;
  v_new_version_id uuid;
  v_created uuid[] := '{}';
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede aplicar el IPC';
  end if;

  select * into v_ipc from ipc_indexes where id = p_ipc_id for update;
  if not found then
    raise exception 'IPC % no encontrado', p_ipc_id;
  end if;
  if v_ipc.status = 'applied' then
    raise exception 'Este IPC ya fue aplicado';
  end if;

  for v_list in select id from price_lists loop
    select id into v_base_version_id from price_list_versions
      where price_list_id = v_list.id and status = 'published' and effective_date <= current_date
      order by effective_date desc limit 1;

    if v_base_version_id is null then
      continue; -- oficio sin lista vigente todavía: no hay nada de qué partir
    end if;

    insert into price_list_versions (price_list_id, version_label, status, effective_date, source_ipc_id)
      values (v_list.id, p_version_label, 'draft', p_effective_date, p_ipc_id)
      on conflict (price_list_id, version_label) do nothing
      returning id into v_new_version_id;

    if v_new_version_id is null then
      continue; -- ya existía una versión con ese rótulo para este oficio
    end if;

    insert into price_items (price_list_version_id, service_id, base_price)
      select v_new_version_id, pi.service_id, round(pi.base_price * (1 + v_ipc.value / 100), 2)
      from price_items pi
      where pi.price_list_version_id = v_base_version_id;

    v_created := array_append(v_created, v_new_version_id);
    v_new_version_id := null;
  end loop;

  update ipc_indexes set status = 'applied' where id = p_ipc_id;

  insert into audit_logs (actor_id, entity, entity_id, action, new_value)
    values (auth.uid(), 'ipc_indexes', p_ipc_id, 'apply', jsonb_build_object('versions', v_created));

  return jsonb_build_object('versions', v_created);
end;
$$;

grant execute on function apply_ipc_update(uuid, date, text) to authenticated;

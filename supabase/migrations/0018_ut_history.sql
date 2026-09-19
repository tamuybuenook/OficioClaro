-- 0018_ut_history.sql
-- Adapta el pedido genérico de "tenant" al modelo real de OficioClaro: cada
-- profesional (profiles) ES su propio tenant. Reutiliza profiles.unit_value
-- como "valor vigente cacheado" (no se rompe nada de lo existente: toda la
-- app sigue leyendo profiles.unit_value) y agrega el histórico inmutable acá.

create table ut_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  value numeric(12,2) not null,
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  note text
);
create index ut_history_user_idx on ut_history(user_id, valid_from);

-- A lo sumo un registro vigente (valid_to is null) por usuario.
create unique index ut_history_one_open_per_user on ut_history(user_id) where valid_to is null;

alter table ut_history enable row level security;
create policy ut_history_own on ut_history
  for select using (user_id = auth.uid() or is_admin());
-- Los inserts/updates de historial solo ocurren vía la función set_ut_value (security definer).

grant select on ut_history to authenticated;

-- Método de actualización de precios por usuario (sección 2). No obligatorio: default 'manual'.
alter table profiles add column price_update_method text not null default 'manual' check (price_update_method in ('manual', 'ut', 'percentage'));
alter table profiles add column percentage_value numeric(5,2);

-- Cierra el valor vigente anterior (si existe) y crea uno nuevo, manteniendo
-- profiles.unit_value sincronizado. Nunca modifica destructivamente un registro histórico ya cerrado.
create or replace function set_ut_value(p_user_id uuid, p_value numeric, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
begin
  if auth.uid() is distinct from p_user_id and not is_admin() then
    raise exception 'No autorizado';
  end if;
  if p_value <= 0 then
    raise exception 'El valor de UT debe ser mayor a cero';
  end if;

  update ut_history set valid_to = current_date where user_id = p_user_id and valid_to is null;

  insert into ut_history (user_id, value, valid_from, created_by, note)
  values (p_user_id, p_value, current_date, auth.uid(), p_note)
  returning id into v_new_id;

  update profiles set unit_value = p_value, updated_at = now() where id = p_user_id;

  return v_new_id;
end;
$$;

grant execute on function set_ut_value(uuid, numeric, text) to authenticated;

-- Reconstruye qué valor de UT estaba vigente para un usuario en una fecha dada.
create or replace function get_ut_at(p_user_id uuid, p_date date default current_date)
returns numeric
language sql stable
as $$
  select value from ut_history
  where user_id = p_user_id
    and valid_from <= p_date
    and (valid_to is null or valid_to >= p_date)
  order by valid_from desc
  limit 1;
$$;

grant execute on function get_ut_at(uuid, date) to authenticated;

-- Migra el valor actual de cada usuario como su primer registro histórico (sección 1: "histórico inicial").
insert into ut_history (user_id, value, valid_from, created_by, note)
select id, unit_value, created_at::date, id, 'Valor inicial migrado'
from profiles
where unit_value > 0;

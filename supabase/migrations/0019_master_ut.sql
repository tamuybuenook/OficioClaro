-- 0019_master_ut.sql
-- El catálogo maestro (services.ut_coefficient) ya guarda solo la CANTIDAD de UT
-- de cada trabajo (sin cambios). Esto agrega el VALOR MONETARIO de esa UT como
-- entidad histórica propia del sistema (no de un usuario), análoga a ut_history.

create table master_ut_history (
  id uuid primary key default gen_random_uuid(),
  value numeric(12,2) not null,
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  note text
);
create index master_ut_history_valid_idx on master_ut_history(valid_from);
create unique index master_ut_history_one_open on master_ut_history((true)) where valid_to is null;

alter table master_ut_history enable row level security;
create policy master_ut_history_read on master_ut_history for select using (auth.role() = 'authenticated');
grant select on master_ut_history to authenticated;

-- Cierra el valor vigente y crea uno nuevo (solo admin). Nunca sobrescribe históricos.
create or replace function set_master_ut_value(p_value numeric, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede cambiar el valor de UT maestro';
  end if;
  if p_value <= 0 then
    raise exception 'El valor de UT debe ser mayor a cero';
  end if;

  update master_ut_history set valid_to = current_date where valid_to is null;

  insert into master_ut_history (value, valid_from, created_by, note)
  values (p_value, current_date, auth.uid(), p_note)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function set_master_ut_value(numeric, text) to authenticated;

-- Valor de UT maestro vigente en una fecha dada (por defecto, hoy).
create or replace function get_master_ut_at(p_date date default current_date)
returns numeric
language sql stable
as $$
  select value from master_ut_history
  where valid_from <= p_date and (valid_to is null or valid_to >= p_date)
  order by valid_from desc
  limit 1;
$$;

grant execute on function get_master_ut_at(date) to authenticated;

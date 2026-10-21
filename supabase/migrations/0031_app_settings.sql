-- 0031_app_settings.sql — Política de suscripciones configurable (aviso previo y período de gracia).
-- Aditiva: no modifica tablas ni funciones existentes. La duración de la prueba sigue en plans.trial_days.
-- NO se aplica sola: ejecutar manualmente (primero en un proyecto de prueba). Ver docs/INFORME_CIERRE_ETAPA6B.md.

create table if not exists public.app_settings (
  key text primary key check (key in ('notice_days', 'grace_days')),
  value integer not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_settings_range check (
    (key = 'notice_days' and value between 1 and 15) or (key = 'grace_days' and value between 0 and 30))
);

insert into public.app_settings (key, value) values ('notice_days', 5), ('grace_days', 5)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

-- Lectura: cualquier usuario autenticado (no son datos sensibles; el servidor los necesita para calcular avisos).
-- Escritura: solo admin, solo la columna value (la clave es inmutable; no se insertan ni borran filas).
create policy app_settings_read on public.app_settings for select to authenticated using (true);
create policy app_settings_admin_update on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
grant update (value) on public.app_settings to authenticated;

-- El autor y la fecha no se pueden falsear desde el cliente.
create or replace function public.app_settings_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function public.app_settings_stamp() from public, anon, authenticated;

drop trigger if exists app_settings_stamp on public.app_settings;
create trigger app_settings_stamp before update on public.app_settings
  for each row execute function public.app_settings_stamp();

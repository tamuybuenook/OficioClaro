-- Stubs mínimos de Supabase para correr las migraciones en un Postgres vanilla (SOLO PRUEBAS LOCALES).
-- No forma parte de las migraciones ni se despliega.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  email_confirmed_at timestamptz default now()   -- como un alta confirmada/OAuth; los tests de 0025 lo pisan
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.role() to anon, authenticated;

-- Emula el comportamiento de Supabase: EXECUTE por defecto para los roles de la API en funciones nuevas del esquema public.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

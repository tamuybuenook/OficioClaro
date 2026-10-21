-- 0024_mp_hardening.sql
-- Endurecimiento posterior a la revisión de seguridad de la integración de Mercado Pago.
-- Incremental y compatible con 0001–0023. No toca agenda, presupuestos ni clientes.

-- =========================================================
-- 1. Regla de acceso por suscripción (espejo de lib/subscription-access.ts)
-- =========================================================
create or replace function subscription_has_access(p_status text, p_end date)
returns boolean language sql stable as $$
  select case
    when p_status not in ('trial', 'active', 'past_due', 'cancelled') then false
    when p_end is null then p_status = 'active'
    else p_end >= (now() at time zone 'America/Argentina/Buenos_Aires')::date
  end
$$;

-- Límite de oficios vigente: 0 = sin acceso; null = sin límite.
create or replace function user_trade_limit(p_user uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_status text; v_end date; v_max integer; v_found boolean;
begin
  select s.status, s.end_date, p.max_trades, true into v_status, v_end, v_max, v_found
    from subscriptions s join plans p on p.id = s.plan_id
   where s.user_id = p_user order by s.created_at desc limit 1;
  if v_found is not true or not subscription_has_access(v_status, v_end) then return 0; end if;
  return v_max;
end;
$$;

-- =========================================================
-- 2. El límite de oficios también se aplica en la base
--    (user_trades_own permitía insertar directamente con la clave pública, salteando la Server Action).
--    Solo bloquea ALTAS nuevas: no borra ni oculta datos existentes (bajar de plan conserva todo).
-- =========================================================
create or replace function enforce_user_trades_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_limit integer; v_count integer;
begin
  if auth.uid() is null or is_admin() then return new; end if; -- servicio / admin
  perform pg_advisory_xact_lock(hashtextextended('trades:' || new.user_id::text, 0));
  v_limit := user_trade_limit(new.user_id);
  if v_limit is null then return new; end if;
  select count(*) into v_count from user_trades where user_id = new.user_id;
  if v_count + 1 > v_limit then
    raise exception 'Tu plan actual no permite agregar más oficios (límite: %).', v_limit;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_user_trades_limit on user_trades;
create trigger trg_user_trades_limit before insert on user_trades
  for each row execute function enforce_user_trades_limit();

-- =========================================================
-- 3. Prueba gratuita: una por persona (email normalizado), no reiniciable creando cuentas
-- =========================================================
create or replace function normalize_email(p text)
returns text language sql immutable as $$
  select case
    when nullif(trim(p), '') is null or position('@' in p) = 0 then null
    when split_part(lower(trim(p)), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(trim(p)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(lower(trim(p)), '@', 1), '+', 1) || '@' || split_part(lower(trim(p)), '@', 2)
  end
$$;

create table if not exists trial_claims (
  email_norm text primary key,
  user_id uuid,                 -- sin FK: borrar la cuenta no libera la prueba
  created_at timestamptz not null default now()
);
alter table trial_claims enable row level security;
revoke all on trial_claims from anon, authenticated;

-- Quienes ya existen no pueden reclamar otra prueba al recrear la cuenta.
insert into trial_claims(email_norm, user_id)
select distinct on (normalize_email(u.email)) normalize_email(u.email), u.id
  from auth.users u join profiles pr on pr.id = u.id
 where normalize_email(u.email) is not null
 order by normalize_email(u.email), pr.created_at
on conflict do nothing;

create or replace function handle_new_profile_trial()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan record;
  v_email text;
  v_norm text;
  v_claimed integer := 1;
begin
  select id, trial_days into v_plan from plans where is_active = true order by (max_trades is null) desc, price asc limit 1;
  if v_plan.id is null then return new; end if;

  select email into v_email from auth.users where id = new.id;
  v_norm := normalize_email(v_email);
  if v_norm is not null then
    insert into trial_claims(email_norm, user_id) values (v_norm, new.id) on conflict do nothing;
    get diagnostics v_claimed = row_count;
  end if;

  if v_claimed > 0 then
    insert into subscriptions (user_id, plan_id, status, start_date, end_date)
    values (new.id, v_plan.id, 'trial', current_date, (current_date + (v_plan.trial_days || ' days')::interval)::date);
  else
    -- Esa persona ya usó su prueba: queda sin acceso hasta que pague (no hay segunda prueba).
    insert into subscriptions (user_id, plan_id, status, start_date, end_date)
    values (new.id, v_plan.id, 'past_due', current_date, current_date - 1);
  end if;
  return new;
end;
$$;

-- Como máximo una suscripción en prueba por usuario (solo si los datos actuales lo permiten).
do $$
begin
  if not exists (select 1 from subscriptions where status = 'trial' group by user_id having count(*) > 1) then
    create unique index if not exists subscriptions_one_trial_per_user on subscriptions(user_id) where status = 'trial';
  else
    raise notice 'Hay usuarios con más de una prueba: revisar manualmente antes de crear subscriptions_one_trial_per_user';
  end if;
end $$;

-- =========================================================
-- 4. Limitación de frecuencia compartida entre instancias (ventana fija en Postgres)
-- =========================================================
create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table rate_limits enable row level security;
revoke all on rate_limits from anon, authenticated;

-- true = permitido; false = excedido. Solo service_role.
create or replace function rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_start timestamptz; v_hits integer;
begin
  if p_key is null or p_max < 1 or p_window_seconds < 1 then raise exception 'rate_limit: parámetros inválidos'; end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into rate_limits(key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into v_hits;
  delete from rate_limits where key = p_key and window_start < now() - interval '2 days'; -- limpieza barata por clave
  return v_hits <= p_max;
end;
$$;
revoke all on function rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, integer, integer) to service_role;

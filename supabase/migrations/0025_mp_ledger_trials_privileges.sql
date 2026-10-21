-- 0025_mp_ledger_trials_privileges.sql
-- Cierre de riesgos pendientes de la integración de Mercado Pago. Incremental sobre 0001–0024.
--  A. Registro (ledger) de autorizaciones recurrentes: trazabilidad y reemplazo recuperable.
--  B. record_mp_payment v2 (renovaciones asociadas al ledger).
--  C. Conciliación de transferencias atómica (RPC).
--  D. Prueba gratuita solo con email válido y verificado.
--  E. Funciones privilegiadas: search_path vacío, referencias calificadas y permisos mínimos.
-- No toca agenda (0022), presupuestos ni clientes.

-- Fecha de hoy en Argentina: la misma referencia que usa la regla de acceso (current_date usa la zona horaria
-- del servidor y entre las 21:00 y las 24:00 de Argentina ya es "mañana": una prueba vencida seguiría con acceso).
create or replace function public.ar_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

-- =========================================================
-- A. Ledger de preapprovals
-- =========================================================
create table if not exists public.mp_preapprovals (
  id uuid primary key default gen_random_uuid(),           -- también es el external_reference enviado a MP
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  amount numeric(12,2) not null check (amount > 0),
  preapproval_id text unique,                              -- id de MP (null mientras 'creating')
  status text not null default 'creating'
    check (status in ('creating', 'pending', 'authorized', 'paused', 'cancelling', 'cancelled', 'failed')),
  init_point text,
  cancel_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists mp_preapprovals_sub_idx on public.mp_preapprovals(subscription_id);
-- A lo sumo UNA autorización abierta por suscripción (guardia contra solicitudes simultáneas y reemplazos a medias).
create unique index if not exists mp_preapprovals_one_open_uidx
  on public.mp_preapprovals(subscription_id) where status in ('creating', 'pending', 'authorized', 'paused', 'cancelling');

alter table public.mp_preapprovals enable row level security;
create policy mp_preapprovals_admin_read on public.mp_preapprovals for select using (public.is_admin());
revoke all on public.mp_preapprovals from anon, authenticated;
grant select on public.mp_preapprovals to authenticated; -- RLS: solo admin

-- Backfill desde las columnas mp_* de 0023 (antes de crear el trigger espejo).
insert into public.mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status, init_point)
select s.id, s.mp_plan_id, s.mp_amount, s.mp_preapproval_id,
       case s.mp_status when 'authorized' then 'authorized' when 'paused' then 'paused' when 'cancelled' then 'cancelled' else 'pending' end,
       s.mp_init_point
  from public.subscriptions s
 where s.mp_preapproval_id is not null and s.mp_plan_id is not null and s.mp_amount is not null
on conflict (preapproval_id) do nothing;

-- Las columnas subscriptions.mp_* pasan a ser un ESPEJO de la autorización vigente (la mantiene este trigger, atómico).
create or replace function public.sync_mp_mirror()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.mp_preapprovals%rowtype;
begin
  select * into r from public.mp_preapprovals where subscription_id = new.subscription_id
   order by (status in ('creating', 'pending', 'authorized', 'paused', 'cancelling')) desc, created_at desc limit 1;
  update public.subscriptions
     set mp_preapproval_id = r.preapproval_id, mp_plan_id = r.plan_id, mp_amount = r.amount,
         mp_status = case r.status when 'creating' then 'pending' when 'cancelling' then 'pending' when 'failed' then null else r.status end,
         mp_init_point = case when r.status = 'pending' then r.init_point else null end
   where id = new.subscription_id;
  -- Una autorización que estaba vigente y se cancela: sin renovación; el acceso sigue hasta end_date.
  if tg_op = 'UPDATE' and old.status = 'authorized' and new.status = 'cancelled' then
    update public.subscriptions set status = 'cancelled', cancelled_at = now()
     where id = new.subscription_id and status in ('active', 'past_due');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mp_preapprovals_mirror on public.mp_preapprovals;
create trigger trg_mp_preapprovals_mirror after insert or update on public.mp_preapprovals
  for each row execute function public.sync_mp_mirror();

-- =========================================================
-- B. record_mp_payment v2: las renovaciones se resuelven por el ledger (monto/plan congelados por autorización)
-- =========================================================
drop function if exists public.record_mp_payment(uuid, uuid, text, text, text, numeric, text);

create or replace function public.record_mp_payment(
  p_intent_id uuid,
  p_subscription_id uuid,
  p_external_id text,
  p_mp_status text,
  p_mp_status_detail text,
  p_amount numeric,
  p_currency text,
  p_preapproval_id text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_pay public.payments%rowtype;
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_row public.mp_preapprovals%rowtype;
  v_expected numeric;
  v_base date;
  v_new_end date;
  v_recurring boolean := (p_intent_id is null);
begin
  if p_external_id is null or length(p_external_id) = 0 then raise exception 'mp:missing_external_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mp:' || p_external_id, 0));

  v_status := case p_mp_status
    when 'approved' then 'reconciled'
    when 'pending' then 'pending' when 'in_process' then 'pending' when 'authorized' then 'pending'
    when 'in_mediation' then 'pending'
    when 'rejected' then 'rejected' when 'cancelled' then 'rejected'
    when 'refunded' then 'refunded' when 'charged_back' then 'refunded'
    else null end;
  if v_status is null then return jsonb_build_object('outcome', 'ignored', 'detail', 'estado desconocido: ' || coalesce(p_mp_status, 'null')); end if;
  if coalesce(upper(p_currency), '') <> 'ARS' then raise exception 'mp:currency_mismatch'; end if;

  if v_recurring then
    if p_preapproval_id is null or p_subscription_id is null then raise exception 'mp:no_preapproval'; end if;
    select * into v_row from public.mp_preapprovals where preapproval_id = p_preapproval_id and subscription_id = p_subscription_id;
    if not found then raise exception 'mp:no_preapproval'; end if;
  end if;

  select * into v_pay from public.payments where provider = 'mercadopago' and external_id = p_external_id for update;

  if not found then
    if not v_recurring then
      select * into v_pay from public.payments where id = p_intent_id and provider = 'mercadopago' for update;
      if not found then raise exception 'mp:intent_not_found'; end if;
      if v_pay.external_id is not null then
        -- Otro intento de pago sobre la misma preferencia (p.ej. el primero fue rechazado): fila nueva.
        insert into public.payments(subscription_id, provider, amount, reference, status, external_id, plan_id, mp_status, mp_status_detail)
        values (v_pay.subscription_id, 'mercadopago', v_pay.amount, v_pay.reference, 'pending', p_external_id, v_pay.plan_id, p_mp_status, p_mp_status_detail)
        returning * into v_pay;
      else
        update public.payments set external_id = p_external_id where id = v_pay.id returning * into v_pay;
      end if;
      v_expected := v_pay.amount;
    else
      v_expected := v_row.amount;
      insert into public.payments(subscription_id, provider, amount, reference, status, external_id, plan_id, mp_status, mp_status_detail)
      values (v_row.subscription_id, 'mercadopago', v_row.amount, 'preapproval:' || p_preapproval_id, 'pending', p_external_id, v_row.plan_id, p_mp_status, p_mp_status_detail)
      returning * into v_pay;
    end if;
  else
    v_expected := v_pay.amount;
    if v_recurring then
      if v_pay.subscription_id is distinct from p_subscription_id then raise exception 'mp:reference_mismatch'; end if;
    elsif v_pay.subscription_id is distinct from (select subscription_id from public.payments where id = p_intent_id) then
      raise exception 'mp:reference_mismatch';
    end if;
  end if;

  if p_amount is null or p_amount <> v_expected then raise exception 'mp:amount_mismatch'; end if;
  if v_pay.plan_id is null then raise exception 'mp:missing_plan'; end if;

  if v_pay.status = v_status then
    update public.payments set mp_status = p_mp_status, mp_status_detail = p_mp_status_detail, updated_at = now() where id = v_pay.id;
    if not (v_status = 'reconciled' and v_pay.applied_at is null) then
      return jsonb_build_object('outcome', 'duplicate', 'payment_id', v_pay.id);
    end if;
  elsif (v_pay.status = 'reconciled' and v_status in ('pending', 'rejected'))
     or (v_pay.status in ('rejected', 'refunded') and v_status in ('pending', 'reconciled'))
     or (v_pay.status = 'refunded') then
    return jsonb_build_object('outcome', 'ignored', 'detail', 'notificación desactualizada', 'payment_id', v_pay.id);
  end if;

  update public.payments set status = v_status, mp_status = p_mp_status, mp_status_detail = p_mp_status_detail, updated_at = now()
   where id = v_pay.id;

  select * into v_sub from public.subscriptions where id = v_pay.subscription_id for update;
  if not found then raise exception 'mp:subscription_not_found'; end if;

  if v_status = 'reconciled' and v_pay.applied_at is null then
    select * into v_plan from public.plans where id = v_pay.plan_id;
    if not found then raise exception 'mp:plan_not_found'; end if;
    v_base := greatest(coalesce(v_sub.end_date, public.ar_today()), public.ar_today());
    v_new_end := case when v_plan.billing_period = 'yearly' then (v_base + interval '1 year')::date
                      else (v_base + interval '1 month')::date end;
    -- Una cuenta suspendida por un admin NO se reactiva sola con un pago.
    update public.subscriptions
       set plan_id = v_plan.id,
           status = case when v_sub.status = 'suspended' then 'suspended' else 'active' end,
           end_date = v_new_end, cancelled_at = null
     where id = v_sub.id;
    update public.payments set applied_at = now() where id = v_pay.id;
    insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
    values (null, 'payments', v_pay.id, 'mp_approved', jsonb_build_object('external_id', p_external_id, 'plan_id', v_plan.id, 'end_date', v_new_end, 'kept_suspended', v_sub.status = 'suspended'));
    if v_recurring and v_row.status in ('cancelling', 'cancelled', 'failed') then
      -- Dinero real cobrado por una autorización que el sistema ya había reemplazado/cancelado: se acredita y se señala.
      insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
      values (null, 'mp_preapprovals', v_row.id, 'mp_incident_charge_on_replaced',
              jsonb_build_object('preapproval_id', p_preapproval_id, 'external_id', p_external_id, 'ledger_status', v_row.status));
    end if;
    return jsonb_build_object('outcome', 'processed', 'payment_id', v_pay.id, 'end_date', v_new_end);
  end if;

  if v_status = 'rejected' and v_recurring and v_row.status = 'authorized' and v_sub.status = 'active' then
    update public.subscriptions set status = 'past_due' where id = v_sub.id;  -- el acceso sigue hasta end_date
  end if;

  if v_status = 'refunded' then
    insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
    values (null, 'payments', v_pay.id, 'mp_refunded', jsonb_build_object('external_id', p_external_id, 'mp_status', p_mp_status));
  end if;

  return jsonb_build_object('outcome', 'processed', 'payment_id', v_pay.id, 'status', v_status);
end;
$$;

-- =========================================================
-- C. Conciliación de TRANSFERENCIAS atómica
--    Estado del pago + extensión de la suscripción + registro de conciliación + auditoría en UNA transacción.
-- =========================================================
create or replace function public.reconcile_transfer_payment(p_payment_id uuid, p_status text, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments%rowtype;
  v_sub public.subscriptions%rowtype;
  v_period text;
  v_base date;
  v_new_end date;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'No autorizado: solo un administrador puede conciliar.'; end if;
  if p_status not in ('reconciled', 'rejected') then raise exception 'Estado inválido.'; end if;

  select * into v_pay from public.payments where id = p_payment_id for update;   -- serializa solicitudes simultáneas
  if not found then raise exception 'Pago no encontrado.'; end if;
  if v_pay.provider <> 'transfer' then raise exception 'Solo se concilian transferencias manualmente.'; end if;
  if v_pay.status <> 'pending' then raise exception 'Ese pago ya fue resuelto.'; end if;

  update public.payments set status = p_status, updated_at = now() where id = v_pay.id;
  insert into public.bank_reconciliations(payment_id, reconciled_by, status, notes) values (v_pay.id, auth.uid(), p_status, p_notes);

  if p_status = 'reconciled' then
    select * into v_sub from public.subscriptions where id = v_pay.subscription_id for update;
    if not found then raise exception 'Suscripción no encontrada.'; end if;
    select billing_period into v_period from public.plans where id = v_sub.plan_id;
    v_base := greatest(coalesce(v_sub.end_date, public.ar_today()), public.ar_today());
    v_new_end := case when v_period = 'yearly' then (v_base + interval '1 year')::date else (v_base + interval '1 month')::date end;
    update public.subscriptions set status = 'active', end_date = v_new_end where id = v_sub.id;
  end if;

  insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
  values (auth.uid(), 'payments', v_pay.id, 'reconcile', jsonb_build_object('status', p_status, 'notes', p_notes, 'end_date', v_new_end));
  return jsonb_build_object('outcome', 'ok', 'status', p_status, 'end_date', v_new_end);
end;
$$;

-- =========================================================
-- D. Prueba gratuita: solo con email VÁLIDO y VERIFICADO; una por email normalizado (no es prueba de identidad)
-- =========================================================
create or replace function public.normalize_email(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p is null or p !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or length(p) > 254 then null   -- inexistente o inválido
    when split_part(lower(trim(p)), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(trim(p)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(lower(trim(p)), '@', 1), '+', 1) || '@' || split_part(lower(trim(p)), '@', 2)
  end
$$;

alter table public.subscriptions add column if not exists trial_pending boolean not null default false; -- espera verificar el email

create or replace function public.handle_new_profile_trial()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_plan record;
  v_email text;
  v_confirmed timestamptz;
  v_norm text;
  v_claimed integer := 0;
  v_pending boolean := false;
begin
  select id, trial_days into v_plan from public.plans where is_active = true order by (max_trades is null) desc, price asc limit 1;
  if v_plan.id is null then return new; end if;

  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = new.id;
  v_norm := public.normalize_email(v_email);

  if v_norm is not null and v_confirmed is not null then
    insert into public.trial_claims(email_norm, user_id) values (v_norm, new.id) on conflict do nothing;
    get diagnostics v_claimed = row_count;
  elsif v_norm is not null then
    v_pending := true;   -- email válido sin verificar: la prueba se concede al verificarlo
  end if;                -- email nulo/inválido: nunca hay prueba automática

  if v_claimed > 0 then
    insert into public.subscriptions (user_id, plan_id, status, start_date, end_date)
    values (new.id, v_plan.id, 'trial', public.ar_today(), (public.ar_today() + (v_plan.trial_days || ' days')::interval)::date);
  else
    insert into public.subscriptions (user_id, plan_id, status, start_date, end_date, trial_pending)
    values (new.id, v_plan.id, 'past_due', public.ar_today(), public.ar_today() - 1, v_pending);
  end if;
  return new;
end;
$$;

-- Al verificarse el email (confirmación por enlace) se concede la prueba pendiente, si esa persona no la usó antes.
create or replace function public.grant_trial_on_email_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_norm text; v_plan record; v_sub public.subscriptions%rowtype; v_claimed integer;
begin
  v_norm := public.normalize_email(new.email);
  select * into v_sub from public.subscriptions where user_id = new.id and trial_pending = true order by created_at desc limit 1;
  if not found then return new; end if;
  if v_norm is null then
    update public.subscriptions set trial_pending = false where id = v_sub.id;
    return new;
  end if;
  insert into public.trial_claims(email_norm, user_id) values (v_norm, new.id) on conflict do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed > 0 then
    select trial_days into v_plan from public.plans where id = v_sub.plan_id;
    update public.subscriptions
       set status = 'trial', start_date = public.ar_today(), trial_pending = false,
           end_date = (public.ar_today() + (coalesce(v_plan.trial_days, 30) || ' days')::interval)::date
     where id = v_sub.id and status = 'past_due';
  else
    update public.subscriptions set trial_pending = false where id = v_sub.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_email_confirmed_grant_trial on auth.users;
create trigger on_auth_email_confirmed_grant_trial
  after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.grant_trial_on_email_confirmed();

-- =========================================================
-- E. Funciones privilegiadas: search_path vacío + referencias calificadas + permisos mínimos
-- =========================================================
create or replace function public.subscription_has_access(p_status text, p_end date)
returns boolean language sql stable set search_path = '' as $$
  select case
    when p_status not in ('trial', 'active', 'past_due', 'cancelled') then false
    when p_end is null then p_status = 'active'
    else p_end >= (now() at time zone 'America/Argentina/Buenos_Aires')::date
  end
$$;

create or replace function public.user_trade_limit(p_user uuid)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare v_status text; v_end date; v_max integer; v_found boolean;
begin
  select s.status, s.end_date, p.max_trades, true into v_status, v_end, v_max, v_found
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.user_id = p_user order by s.created_at desc limit 1;
  if v_found is not true or not public.subscription_has_access(v_status, v_end) then return 0; end if;
  return v_max;
end;
$$;

create or replace function public.enforce_user_trades_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_count integer;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('trades:' || new.user_id::text, 0));
  v_limit := public.user_trade_limit(new.user_id);
  if v_limit is null then return new; end if;
  select count(*) into v_count from public.user_trades where user_id = new.user_id;
  if v_count + 1 > v_limit then
    raise exception 'Tu plan actual no permite agregar más oficios (límite: %).', v_limit;
  end if;
  return new;
end;
$$;

create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_start timestamptz; v_hits integer;
begin
  if p_key is null or p_max < 1 or p_window_seconds < 1 then raise exception 'rate_limit: parámetros inválidos'; end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits(key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  delete from public.rate_limits where key = p_key and window_start < now() - interval '2 days';
  return v_hits <= p_max;
end;
$$;

-- Matriz de permisos de ejecución (Supabase concede EXECUTE por defecto a anon/authenticated/service_role: se retira explícitamente).
--   service_role : record_mp_payment, rate_limit_hit
--   authenticated: reconcile_transfer_payment (verifica is_admin() adentro)
--   nadie (solo triggers / uso interno de otras funciones): el resto
do $$
declare f text;
begin
  foreach f in array array[
    'public.record_mp_payment(uuid, uuid, text, text, text, numeric, text, text)',
    'public.rate_limit_hit(text, integer, integer)',
    'public.reconcile_transfer_payment(uuid, text, text)',
    'public.user_trade_limit(uuid)',
    'public.enforce_user_trades_limit()',
    'public.subscription_has_access(text, date)',
    'public.normalize_email(text)',
    'public.ar_today()',
    'public.handle_new_profile_trial()',
    'public.grant_trial_on_email_confirmed()',
    'public.sync_mp_mirror()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.record_mp_payment(uuid, uuid, text, text, text, numeric, text, text) to service_role;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.reconcile_transfer_payment(uuid, text, text) to authenticated;

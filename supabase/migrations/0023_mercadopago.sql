-- 0023_mercadopago.sql
-- Cobro de suscripciones de OficioClaro con Mercado Pago (pago manual + renovación automática)
-- y corrección de huecos de seguridad detectados en la auditoría de pagos/suscripciones.
-- Incremental: no modifica migraciones aplicadas ni toca agenda, presupuestos ni clientes.

-- =========================================================
-- 1. Seguridad (auditoría)
-- =========================================================

-- 1.a) Un usuario podía insertar pagos con cualquier provider/estado/monto. Ahora solo puede
--      informar una transferencia "pending" sobre su propia suscripción, sin datos de MP.
--      (El alta de pagos de Mercado Pago la hace únicamente el servidor con service_role.)
drop policy if exists payments_own_insert on payments;

-- 1.b) Un usuario podía crearse suscripciones 'trial' ilimitadas (prueba infinita).
--      La prueba la crea el trigger handle_new_profile_trial (security definer); el resto, admin.
drop policy if exists subscriptions_insert on subscriptions;
create policy subscriptions_insert on subscriptions
  for insert with check (is_admin());

-- =========================================================
-- 2. Columnas nuevas (todas nullable / con default: compatible con datos existentes)
-- =========================================================
alter table subscriptions
  add column if not exists mp_preapproval_id text,   -- id de la suscripción recurrente de MP
  add column if not exists mp_plan_id uuid references plans(id),  -- plan por el que se autorizó
  add column if not exists mp_amount numeric(12,2),  -- monto congelado al crear la preapproval
  add column if not exists mp_status text,           -- pending | authorized | paused | cancelled
  add column if not exists mp_init_point text,       -- URL de autorización (reutilizable mientras esté pending)
  add column if not exists cancelled_at timestamptz;

create unique index if not exists subscriptions_mp_preapproval_uidx
  on subscriptions(mp_preapproval_id) where mp_preapproval_id is not null;

alter table payments
  add column if not exists plan_id uuid references plans(id), -- plan que se está pagando
  add column if not exists mp_status text,
  add column if not exists mp_status_detail text,
  add column if not exists checkout_url text,
  add column if not exists applied_at timestamptz,            -- cuándo se extendió la suscripción (una sola vez)
  add column if not exists updated_at timestamptz not null default now();

-- Un pago de MP (external_id) se registra una sola vez: base de la idempotencia.
create unique index if not exists payments_mp_external_uidx
  on payments(external_id) where provider = 'mercadopago' and external_id is not null;

-- Se amplía el check de estados con 'refunded' (reembolsado / contracargo). Lista anterior intacta.
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'payments'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%reconciled%';
  if v_name is not null then execute format('alter table payments drop constraint %I', v_name); end if;
end $$;
alter table payments add constraint payments_status_check
  check (status in ('pending', 'reconciled', 'rejected', 'refunded'));

-- Montos positivos (NOT VALID: no revalida filas históricas).
alter table payments add constraint payments_amount_positive check (amount > 0) not valid;

create policy payments_own_insert on payments
  for insert with check (
    provider = 'transfer' and status = 'pending'
    and external_id is null and plan_id is null and applied_at is null
    and mp_status is null and checkout_url is null
    and exists (select 1 from subscriptions s where s.id = payments.subscription_id and s.user_id = auth.uid())
  );

-- =========================================================
-- 3. Registro de notificaciones (auditoría/conciliación). Solo servidor y admin.
-- =========================================================
create table if not exists mp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  topic text,
  data_id text,
  request_id text,
  outcome text,            -- processed | duplicate | ignored | rejected | error
  detail text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists mp_webhook_events_data_idx on mp_webhook_events(topic, data_id);
alter table mp_webhook_events enable row level security;
create policy mp_webhook_events_admin_read on mp_webhook_events for select using (is_admin());
revoke all on mp_webhook_events from anon, authenticated;
grant select on mp_webhook_events to authenticated; -- RLS: solo admin

-- =========================================================
-- 4. record_mp_payment: aplica un pago de MP ya verificado contra la API (idempotente y atómico)
--    p_intent_id: payments.id creado al iniciar el checkout (pago manual) o null (renovación automática).
--    Lanza 'mp:<codigo>' ante inconsistencias de negocio (monto, moneda, referencia).
-- =========================================================
create or replace function record_mp_payment(
  p_intent_id uuid,
  p_subscription_id uuid,
  p_external_id text,
  p_mp_status text,
  p_mp_status_detail text,
  p_amount numeric,
  p_currency text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_pay payments%rowtype;
  v_sub subscriptions%rowtype;
  v_plan plans%rowtype;
  v_expected numeric;
  v_plan_id uuid;
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

  select * into v_pay from payments where provider = 'mercadopago' and external_id = p_external_id for update;

  if not found then
    if not v_recurring then
      select * into v_pay from payments where id = p_intent_id and provider = 'mercadopago' for update;
      if not found then raise exception 'mp:intent_not_found'; end if;
      if v_pay.external_id is not null then
        -- Otro intento de pago sobre la misma preferencia (p.ej. el primero fue rechazado): fila nueva.
        insert into payments(subscription_id, provider, amount, reference, status, external_id, plan_id, mp_status, mp_status_detail)
        values (v_pay.subscription_id, 'mercadopago', v_pay.amount, v_pay.reference, 'pending', p_external_id, v_pay.plan_id, p_mp_status, p_mp_status_detail)
        returning * into v_pay;
      else
        update payments set external_id = p_external_id where id = v_pay.id returning * into v_pay;
      end if;
      v_expected := v_pay.amount;
    else
      select * into v_sub from subscriptions where id = p_subscription_id for update;
      if not found or v_sub.mp_preapproval_id is null or v_sub.mp_plan_id is null or v_sub.mp_amount is null then
        raise exception 'mp:no_preapproval';
      end if;
      v_expected := v_sub.mp_amount;
      insert into payments(subscription_id, provider, amount, reference, status, external_id, plan_id, mp_status, mp_status_detail)
      values (v_sub.id, 'mercadopago', v_sub.mp_amount, 'preapproval:' || v_sub.mp_preapproval_id, 'pending', p_external_id, v_sub.mp_plan_id, p_mp_status, p_mp_status_detail)
      returning * into v_pay;
    end if;
  else
    -- Pago ya conocido: el monto esperado es el congelado en la fila.
    v_expected := v_pay.amount;
    -- El pago ya registrado debe pertenecer a la misma operación/suscripción que declara la notificación.
    if v_recurring then
      if v_pay.subscription_id is distinct from p_subscription_id then raise exception 'mp:reference_mismatch'; end if;
    elsif v_pay.subscription_id is distinct from (select subscription_id from payments where id = p_intent_id) then
      raise exception 'mp:reference_mismatch';
    end if;
  end if;

  if p_amount is null or p_amount <> v_expected then raise exception 'mp:amount_mismatch'; end if;
  if v_pay.plan_id is null then raise exception 'mp:missing_plan'; end if;

  -- Transiciones válidas (notificaciones duplicadas, tardías o fuera de orden).
  if v_pay.status = v_status then
    update payments set mp_status = p_mp_status, mp_status_detail = p_mp_status_detail, updated_at = now() where id = v_pay.id;
    -- misma fila ya aplicada o pendiente repetida
    if not (v_status = 'reconciled' and v_pay.applied_at is null) then
      return jsonb_build_object('outcome', 'duplicate', 'payment_id', v_pay.id);
    end if;
  elsif (v_pay.status = 'reconciled' and v_status in ('pending', 'rejected'))
     or (v_pay.status in ('rejected', 'refunded') and v_status in ('pending', 'reconciled'))
     or (v_pay.status = 'refunded') then
    return jsonb_build_object('outcome', 'ignored', 'detail', 'notificación desactualizada', 'payment_id', v_pay.id);
  end if;

  update payments set status = v_status, mp_status = p_mp_status, mp_status_detail = p_mp_status_detail, updated_at = now()
   where id = v_pay.id;

  select * into v_sub from subscriptions where id = v_pay.subscription_id for update;
  if not found then raise exception 'mp:subscription_not_found'; end if;

  if v_status = 'reconciled' and v_pay.applied_at is null then
    select * into v_plan from plans where id = v_pay.plan_id;
    if not found then raise exception 'mp:plan_not_found'; end if;
    v_base := greatest(coalesce(v_sub.end_date, current_date), current_date);
    v_new_end := case when v_plan.billing_period = 'yearly' then (v_base + interval '1 year')::date
                      else (v_base + interval '1 month')::date end;
    -- Una cuenta suspendida por un admin NO se reactiva sola con un pago: se registra y extiende el período,
    -- pero el estado 'suspended' solo lo levanta una decisión administrativa explícita.
    update subscriptions
       set plan_id = v_plan.id,
           status = case when v_sub.status = 'suspended' then 'suspended' else 'active' end,
           end_date = v_new_end, cancelled_at = null
     where id = v_sub.id;
    update payments set applied_at = now() where id = v_pay.id;
    insert into audit_logs(actor_id, entity, entity_id, action, new_value)
    values (null, 'payments', v_pay.id, 'mp_approved', jsonb_build_object('external_id', p_external_id, 'plan_id', v_plan.id, 'end_date', v_new_end, 'kept_suspended', v_sub.status = 'suspended'));
    return jsonb_build_object('outcome', 'processed', 'payment_id', v_pay.id, 'end_date', v_new_end);
  end if;

  if v_status = 'rejected' and v_recurring and v_sub.status = 'active' then
    -- Renovación fallida: pasa a past_due; el acceso sigue hasta end_date (período ya pagado).
    update subscriptions set status = 'past_due' where id = v_sub.id;
  end if;

  if v_status = 'refunded' then
    -- No se revoca el acceso automáticamente: queda auditado para decisión de un admin.
    insert into audit_logs(actor_id, entity, entity_id, action, new_value)
    values (null, 'payments', v_pay.id, 'mp_refunded', jsonb_build_object('external_id', p_external_id, 'mp_status', p_mp_status));
  end if;

  return jsonb_build_object('outcome', 'processed', 'payment_id', v_pay.id, 'status', v_status);
end;
$$;

revoke all on function record_mp_payment(uuid, uuid, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function record_mp_payment(uuid, uuid, text, text, text, numeric, text) to service_role;

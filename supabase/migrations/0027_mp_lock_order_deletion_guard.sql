-- 0027_mp_lock_order_deletion_guard.sql
-- Correcciones de seguridad de la etapa 1 (incremental; NO modifica 0023–0026, que ya pueden estar aplicadas).
--  1. Carrera entre record_mp_payment y la cancelación: la decisión de retener/acreditar usa el estado VIGENTE de la
--     autorización (fila del ledger bloqueada FOR UPDATE) y de la suscripción, con un orden único de bloqueos que evita
--     interbloqueos:   ledger  ->  pago  ->  suscripción.
--        trigger espejo:            ledger -> suscripción
--        record_mp_payment (recurr.): ledger -> pago -> suscripción      (antes: pago -> suscripción con ledger SIN bloquear)
--        record_mp_payment (manual) / resolve_held_mp_payment / reconcile_transfer_payment: pago -> suscripción
--        mp_begin_wind_down / mp_begin_user_deletion: ledger -> suscripción   (wind_down antes iba suscripción -> ledger)
--  2. Eliminación de usuarios: retención de eliminación (no se abren autorizaciones nuevas mientras se prepara) y guardia en
--     base que impide borrar una suscripción con una autorización abierta o sin confirmar.

alter table public.subscriptions add column if not exists deletion_hold_at timestamptz;  -- retención por eliminación en curso (vence sola)

-- Una retención vigente dura 30 min: si el proceso muere a mitad de camino, la cuenta no queda bloqueada para siempre.
create or replace function public.mp_deletion_hold_active(p_hold timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p_hold is not null and p_hold > now() - interval '30 minutes'
$$;

create or replace function public.sync_mp_mirror()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.mp_preapprovals%rowtype;
  v_sub public.subscriptions%rowtype;
begin
  -- GUARDIA DE ALTA: una autorización nueva (abierta) no puede abrirse sobre una cuenta suspendida ni mientras se prepara
  -- su eliminación. Se toma el bloqueo de la suscripción (orden: ledger -> suscripción) y se lee su estado VIGENTE; si otra
  -- transacción la suspendió o inició la eliminación, se espera su confirmación y se decide con el estado ya confirmado.
  if tg_op = 'INSERT' and new.status in ('creating', 'pending', 'authorized', 'paused', 'cancelling') then
    select * into v_sub from public.subscriptions where id = new.subscription_id for update;
    if found and (v_sub.status = 'suspended' or public.mp_deletion_hold_active(v_sub.deletion_hold_at)) then
      raise exception 'mp:renewals_blocked' using errcode = 'P0001';
    end if;
  end if;
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
  v_hold text;
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
    -- Orden de bloqueos: ledger -> pago -> suscripción (el mismo de mp_begin_wind_down y del trigger espejo; sin interbloqueos).
    -- FOR UPDATE: si una cancelación está en curso, se espera su confirmación y se decide con el estado VIGENTE (no uno obsoleto).
    select * into v_row from public.mp_preapprovals where preapproval_id = p_preapproval_id and subscription_id = p_subscription_id for update;
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
    -- Un cobro retenido para revisión (review_reason) no se reaplica por una notificación repetida: lo resuelve un admin.
    if not (v_status = 'reconciled' and v_pay.applied_at is null and v_pay.review_reason is null) then
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
    -- RETENCIÓN: no se acredita en silencio un cobro que contradice el estado local de la cuenta.
    --  * cuenta suspendida (cualquier cobro) · * cuenta cancelada y cobro de una autorización ya cerrada.
    -- El dinero queda registrado (status reconciled, applied_at null, review_reason) sin cambiar plan, vencimiento ni acceso.
    v_hold := case
      when v_sub.status = 'suspended' then 'subscription_suspended'
      when v_recurring and v_sub.status = 'cancelled' and v_row.status in ('cancelling', 'cancelled', 'failed') then 'subscription_cancelled'
      else null end;
    if v_hold is not null then
      update public.payments set review_reason = v_hold, updated_at = now() where id = v_pay.id;
      insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
      values (null, 'payments', v_pay.id, 'mp_incident_payment_held',
              jsonb_build_object('external_id', p_external_id, 'reason', v_hold, 'subscription_status', v_sub.status,
                                 'preapproval_id', p_preapproval_id, 'amount', p_amount));
      return jsonb_build_object('outcome', 'held', 'payment_id', v_pay.id, 'reason', v_hold);
    end if;
    select * into v_plan from public.plans where id = v_pay.plan_id;
    if not found then raise exception 'mp:plan_not_found'; end if;
    v_base := greatest(coalesce(v_sub.end_date, public.ar_today()), public.ar_today());
    v_new_end := case when v_plan.billing_period = 'yearly' then (v_base + interval '1 year')::date
                      else (v_base + interval '1 month')::date end;
    update public.subscriptions
       set plan_id = v_plan.id,
           status = 'active',
           end_date = v_new_end, cancelled_at = null
     where id = v_sub.id;
    update public.payments set applied_at = now() where id = v_pay.id;
    insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
    values (null, 'payments', v_pay.id, 'mp_approved', jsonb_build_object('external_id', p_external_id, 'plan_id', v_plan.id, 'end_date', v_new_end));
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
    -- Un cobro retenido que MP reembolsó queda resuelto.
    update public.payments set review_resolution = 'refunded', reviewed_at = now()
     where id = v_pay.id and review_reason is not null and review_resolution is null;
  end if;

  return jsonb_build_object('outcome', 'processed', 'payment_id', v_pay.id, 'status', v_status);
end;
$$;

create or replace function public.mp_begin_wind_down(p_subscription_id uuid, p_status text, p_plan_id uuid, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sub public.subscriptions%rowtype;
  v_ids uuid[];
begin
  if p_status not in ('suspended', 'cancelled') then raise exception 'Estado inválido para esta operación.'; end if;
  -- Orden de bloqueos: ledger -> suscripción (igual que el trigger espejo y record_mp_payment). Sentencias separadas: la
  -- actualización posterior ve las filas confirmadas mientras se esperaba.
  perform 1 from public.mp_preapprovals where subscription_id = p_subscription_id order by id for update;
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;   -- serializa solicitudes simultáneas
  if not found then raise exception 'Suscripción no encontrada.'; end if;

  update public.subscriptions
     set status = p_status,
         plan_id = coalesce(p_plan_id, plan_id),
         cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end
   where id = v_sub.id;

  -- Todas las autorizaciones vivas (incluida una creación en curso) pasan a seguimiento. Las que ya estaban
  -- 'cancelling' conservan su historial de intentos.
  update public.mp_preapprovals set status = 'cancelling', updated_at = now()
   where subscription_id = v_sub.id and status in ('creating', 'pending', 'authorized', 'paused');
  select coalesce(array_agg(id), '{}') into v_ids from public.mp_preapprovals where subscription_id = v_sub.id and status = 'cancelling';

  insert into public.audit_logs(actor_id, entity, entity_id, action, old_value, new_value)
  values (p_actor, 'subscriptions', v_sub.id, 'admin_wind_down',
          jsonb_build_object('status', v_sub.status, 'plan_id', v_sub.plan_id),
          jsonb_build_object('status', p_status, 'plan_id', coalesce(p_plan_id, v_sub.plan_id), 'preapprovals_to_cancel', to_jsonb(v_ids)));
  return jsonb_build_object('previous_status', v_sub.status, 'preapproval_ids', to_jsonb(v_ids));
end;
$$;

-- =========================================================
-- Eliminación de usuario: retención + seguimiento de autorizaciones (solo service_role; el servidor verifica admin)
-- =========================================================
create or replace function public.mp_begin_user_deletion(p_user_id uuid, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sub_ids uuid[];
  v_ids uuid[];
begin
  select coalesce(array_agg(id order by id), '{}') into v_sub_ids from public.subscriptions where user_id = p_user_id;
  -- Orden de bloqueos: ledger -> suscripción.
  perform 1 from public.mp_preapprovals where subscription_id = any(v_sub_ids) order by id for update;
  perform 1 from public.subscriptions where id = any(v_sub_ids) order by id for update;

  update public.subscriptions set deletion_hold_at = now() where id = any(v_sub_ids);
  -- Toda autorización viva (incluida una creación en curso) pasa a seguimiento; las que ya estaban 'cancelling' conservan su historial.
  update public.mp_preapprovals set status = 'cancelling', updated_at = now()
   where subscription_id = any(v_sub_ids) and status in ('creating', 'pending', 'authorized', 'paused');
  select coalesce(array_agg(id), '{}') into v_ids from public.mp_preapprovals where subscription_id = any(v_sub_ids) and status = 'cancelling';

  insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
  values (p_actor, 'profiles', p_user_id, 'admin_delete_user_hold',
          jsonb_build_object('subscriptions', to_jsonb(v_sub_ids), 'preapprovals_to_cancel', to_jsonb(v_ids)));
  return jsonb_build_object('subscription_ids', to_jsonb(v_sub_ids), 'preapproval_ids', to_jsonb(v_ids));
end;
$$;

create or replace function public.mp_end_user_deletion_hold(p_user_id uuid)
returns void
language sql security definer set search_path = '' as $$
  update public.subscriptions set deletion_hold_at = null where user_id = p_user_id and deletion_hold_at is not null
$$;

-- Guardia en base: no se puede borrar una suscripción (ni, en cascada, el usuario) con una autorización abierta o sin
-- confirmar. Las RI en cascada que borran el ledger se ejecutan DESPUÉS de este trigger.
create or replace function public.mp_guard_subscription_delete()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.mp_preapprovals
              where subscription_id = old.id and status in ('creating', 'pending', 'authorized', 'paused', 'cancelling')) then
    raise exception 'mp:open_preapproval' using errcode = 'P0001',
      detail = 'La suscripción tiene una autorización de Mercado Pago abierta o con cancelación sin confirmar.';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_mp_guard_subscription_delete on public.subscriptions;
create trigger trg_mp_guard_subscription_delete before delete on public.subscriptions
  for each row execute function public.mp_guard_subscription_delete();

-- =========================================================
-- Permisos (mínimos)
-- =========================================================
revoke all on function public.mp_deletion_hold_active(timestamptz) from public, anon, authenticated;
revoke all on function public.mp_begin_user_deletion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mp_end_user_deletion_hold(uuid) from public, anon, authenticated;
revoke all on function public.mp_guard_subscription_delete() from public, anon, authenticated;
revoke all on function public.sync_mp_mirror() from public, anon, authenticated;
revoke all on function public.record_mp_payment(uuid, uuid, text, text, text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.mp_begin_wind_down(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mp_begin_user_deletion(uuid, uuid) to service_role;
grant execute on function public.mp_end_user_deletion_hold(uuid) to service_role;
grant execute on function public.record_mp_payment(uuid, uuid, text, text, text, numeric, text, text) to service_role;
grant execute on function public.mp_begin_wind_down(uuid, text, uuid, uuid) to service_role;

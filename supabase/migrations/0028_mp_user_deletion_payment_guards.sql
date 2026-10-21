-- 0028_mp_user_deletion_payment_guards.sql
-- Etapa 1 — protección de pagos únicos (y de cuentas sin suscripción) durante la eliminación de usuarios.
-- Incremental: NO modifica 0023–0027. Reemplaza con CREATE OR REPLACE las funciones indicadas.
--
--  A. Retención de eliminación POR USUARIO (tabla mp_deletion_holds): funciona aunque la cuenta no tenga fila en subscriptions.
--  B. Guardias transaccionales (con advisory lock compartido por usuario) que rechazan —mientras dure la retención— insertar
--     una suscripción, una INTENCIÓN de pago (payments sin external_id) o abrir una autorización. Los cobros reales que
--     registra record_mp_payment (con external_id) nunca se bloquean.
--  C. Guardia de borrado ampliada: no se borra una suscripción con autorización abierta, pago pendiente/en proceso (MP o
--     transferencia) ni cobro retenido sin resolver; y en la MISMA transacción del borrado deja en audit_logs una instantánea
--     de los pagos de MP (ningún cobro desaparece sin rastro).
--  D. mp_expire_intent: única vía para cerrar una intención sin pago (solo vencida: > 25 h = vigencia de la preferencia + margen).
--  E. ORDEN DE BLOQUEOS GLOBAL (sin interbloqueos):  advisory(usuario) -> ledger -> suscripción -> pago.
--     record_mp_payment, resolve_held_mp_payment y reconcile_transfer_payment pasan a bloquear la suscripción ANTES que el pago
--     (un borrado en cascada también toma suscripción -> pagos).

-- =========================================================
-- A. Retención por usuario
-- =========================================================
create table if not exists public.mp_deletion_holds (
  user_id uuid primary key,                 -- sin FK: debe poder existir aunque la cuenta no tenga suscripción
  held_at timestamptz not null default now(),
  actor_id uuid
);
alter table public.mp_deletion_holds enable row level security;      -- sin políticas: solo service_role / funciones definer
revoke all on public.mp_deletion_holds from anon, authenticated;

-- Vigente: 30 min (si el proceso muere a mitad de camino, la cuenta no queda bloqueada para siempre).
create or replace function public.mp_user_deletion_hold_active(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mp_deletion_holds where user_id = p_user and held_at > now() - interval '30 minutes')
$$;

-- Limpieza: al borrarse el perfil se elimina su retención.
create or replace function public.mp_cleanup_deletion_hold()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.mp_deletion_holds where user_id = old.id;
  return old;
end;
$$;
drop trigger if exists trg_mp_cleanup_deletion_hold on public.profiles;
create trigger trg_mp_cleanup_deletion_hold after delete on public.profiles
  for each row execute function public.mp_cleanup_deletion_hold();

-- =========================================================
-- B. Guardias de alta (mientras exista retención)
-- =========================================================
create or replace function public.mp_guard_subscription_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('mp:uhold:' || new.user_id::text, 0));
  if public.mp_user_deletion_hold_active(new.user_id) then
    raise exception 'mp:renewals_blocked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mp_guard_subscription_insert on public.subscriptions;
create trigger trg_mp_guard_subscription_insert before insert on public.subscriptions
  for each row execute function public.mp_guard_subscription_insert();

-- Solo INTENCIONES (external_id nulo): el alta de un cobro real de MP (record_mp_payment, con external_id) nunca se bloquea.
create or replace function public.mp_guard_payment_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if new.external_id is not null then return new; end if;
  select user_id into v_user from public.subscriptions where id = new.subscription_id;
  if v_user is null then return new; end if;     -- el FK informará el error
  perform pg_advisory_xact_lock_shared(hashtextextended('mp:uhold:' || v_user::text, 0));
  if public.mp_user_deletion_hold_active(v_user) then
    raise exception 'mp:renewals_blocked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mp_guard_payment_insert on public.payments;
create trigger trg_mp_guard_payment_insert before insert on public.payments
  for each row execute function public.mp_guard_payment_insert();

-- Guardia de alta de autorizaciones (trigger espejo) con la retención por usuario
create or replace function public.sync_mp_mirror()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.mp_preapprovals%rowtype;
  v_sub public.subscriptions%rowtype;
  v_uid uuid;
begin
  -- GUARDIA DE ALTA: una autorización nueva (abierta) no puede abrirse sobre una cuenta suspendida ni mientras se prepara
  -- su eliminación. Se toma el bloqueo de la suscripción (orden: ledger -> suscripción) y se lee su estado VIGENTE; si otra
  -- transacción la suspendió o inició la eliminación, se espera su confirmación y se decide con el estado ya confirmado.
  if tg_op = 'INSERT' and new.status in ('creating', 'pending', 'authorized', 'paused', 'cancelling') then
    select user_id into v_uid from public.subscriptions where id = new.subscription_id;
    -- Advisory compartido por usuario (el eliminador lo toma exclusivo): se espera a una retención en curso y se decide con ella ya confirmada.
    if v_uid is not null then perform pg_advisory_xact_lock_shared(hashtextextended('mp:uhold:' || v_uid::text, 0)); end if;
    select * into v_sub from public.subscriptions where id = new.subscription_id for update;
    if found and (v_sub.status = 'suspended' or public.mp_user_deletion_hold_active(v_sub.user_id)) then
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

-- =========================================================
-- Retención de eliminación v2 (por usuario)
-- =========================================================
create or replace function public.mp_begin_user_deletion(p_user_id uuid, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sub_ids uuid[];
  v_ids uuid[];
  v_pending uuid[];
begin
  -- Exclusivo: espera a las altas en vuelo (advisory compartido) y serializa dos eliminaciones simultáneas.
  perform pg_advisory_xact_lock(hashtextextended('mp:uhold:' || p_user_id::text, 0));
  insert into public.mp_deletion_holds(user_id, held_at, actor_id) values (p_user_id, now(), p_actor)
  on conflict (user_id) do update set held_at = excluded.held_at, actor_id = excluded.actor_id;

  select coalesce(array_agg(id order by id), '{}') into v_sub_ids from public.subscriptions where user_id = p_user_id;
  -- Orden de bloqueos: ledger -> suscripción.
  perform 1 from public.mp_preapprovals where subscription_id = any(v_sub_ids) order by id for update;
  perform 1 from public.subscriptions where id = any(v_sub_ids) order by id for update;

  update public.mp_preapprovals set status = 'cancelling', updated_at = now()
   where subscription_id = any(v_sub_ids) and status in ('creating', 'pending', 'authorized', 'paused');
  select coalesce(array_agg(id), '{}') into v_ids from public.mp_preapprovals where subscription_id = any(v_sub_ids) and status = 'cancelling';
  select coalesce(array_agg(id), '{}') into v_pending from public.payments
   where subscription_id = any(v_sub_ids)
     and (status = 'pending' or (status = 'reconciled' and applied_at is null and review_resolution is null));

  insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
  values (p_actor, 'profiles', p_user_id, 'admin_delete_user_hold',
          jsonb_build_object('subscriptions', to_jsonb(v_sub_ids), 'preapprovals_to_cancel', to_jsonb(v_ids), 'payments_to_settle', to_jsonb(v_pending)));
  return jsonb_build_object('subscription_ids', to_jsonb(v_sub_ids), 'preapproval_ids', to_jsonb(v_ids), 'pending_payment_ids', to_jsonb(v_pending));
end;
$$;

create or replace function public.mp_end_user_deletion_hold(p_user_id uuid)
returns void
language sql security definer set search_path = '' as $$
  delete from public.mp_deletion_holds where user_id = p_user_id
$$;

-- =========================================================
-- C. Guardia de borrado ampliada + instantánea de pagos
-- =========================================================
create or replace function public.mp_guard_subscription_delete()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb;
begin
  if exists (select 1 from public.mp_preapprovals
              where subscription_id = old.id and status in ('creating', 'pending', 'authorized', 'paused', 'cancelling')) then
    raise exception 'mp:open_preapproval' using errcode = 'P0001',
      detail = 'La suscripción tiene una autorización de Mercado Pago abierta o con cancelación sin confirmar.';
  end if;
  -- Pagos que todavía requieren conciliación (pendientes / en proceso, de MP o transferencia, o cobro retenido sin resolver).
  if exists (select 1 from public.payments
              where subscription_id = old.id
                and (status = 'pending' or (status = 'reconciled' and applied_at is null and review_resolution is null))) then
    raise exception 'mp:pending_payments' using errcode = 'P0001',
      detail = 'La cuenta tiene pagos pendientes, en proceso o retenidos que requieren conciliación.';
  end if;
  -- Instantánea en la MISMA transacción del borrado: ningún cobro de MP desaparece sin rastro.
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', id, 'external_id', external_id, 'amount', amount, 'status', status,
                                               'mp_status', mp_status, 'plan_id', plan_id, 'applied_at', applied_at, 'created_at', created_at) order by created_at), '[]'::jsonb)
    into v_snapshot from public.payments where subscription_id = old.id and provider = 'mercadopago';
  if jsonb_array_length(v_snapshot) > 0 then
    insert into public.audit_logs(actor_id, entity, entity_id, action, old_value)
    values (null, 'subscriptions', old.id, 'mp_payments_snapshot_on_delete', jsonb_build_object('user_id', old.user_id, 'payments', v_snapshot));
  end if;
  return old;
end;
$$;

-- =========================================================
-- D. Cierre de una intención vencida (única vía para dar por terminada una intención sin pago)
-- =========================================================
create or replace function public.mp_expire_intent(p_intent_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sid uuid;
  v_pay public.payments%rowtype;
begin
  select subscription_id into v_sid from public.payments where id = p_intent_id;
  if not found then return jsonb_build_object('expired', false, 'reason', 'not_found'); end if;
  perform 1 from public.subscriptions where id = v_sid for update;            -- suscripción -> pago (orden global)
  select * into v_pay from public.payments where id = p_intent_id for update;
  if not found then return jsonb_build_object('expired', false, 'reason', 'not_found'); end if;
  if v_pay.provider <> 'mercadopago' or v_pay.status <> 'pending' or v_pay.external_id is not null or v_pay.applied_at is not null then
    return jsonb_build_object('expired', false, 'reason', 'not_expirable');   -- hay (o hubo) un pago asociado: se concilia, no se cierra
  end if;
  if v_pay.created_at > now() - interval '25 hours' then
    return jsonb_build_object('expired', false, 'reason', 'too_recent');      -- la preferencia puede seguir vigente
  end if;
  update public.payments set status = 'rejected', mp_status = 'expired', updated_at = now() where id = v_pay.id;
  insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
  values (null, 'payments', v_pay.id, 'mp_intent_expired', jsonb_build_object('created_at', v_pay.created_at, 'mp_status_before', v_pay.mp_status));
  return jsonb_build_object('expired', true);
end;
$$;

-- =========================================================
-- E. Funciones reordenadas (suscripción antes que pago)
-- =========================================================
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
  v_sub_id uuid;
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

  -- Orden de bloqueos GLOBAL: ledger -> suscripción -> pago (igual que un borrado en cascada: suscripción -> pagos).
  -- La suscripción se identifica sin bloquear (el vínculo pago->suscripción es inmutable) y se bloquea ANTES que el pago.
  if v_recurring then
    v_sub_id := p_subscription_id;
  else
    select subscription_id into v_sub_id from public.payments where id = p_intent_id and provider = 'mercadopago';
    if not found then raise exception 'mp:intent_not_found'; end if;
  end if;
  select * into v_sub from public.subscriptions where id = v_sub_id for update;
  if not found then raise exception 'mp:subscription_not_found'; end if;

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

  -- v_sub ya está bloqueado (y es la suscripción del pago: se verificó arriba).

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

create or replace function public.resolve_held_mp_payment(p_payment_id uuid, p_action text, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments%rowtype;
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_base date;
  v_new_end date;
  v_sid uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'No autorizado: solo un administrador puede resolver cobros retenidos.'; end if;
  if p_action not in ('apply', 'refund') then raise exception 'Acción inválida.'; end if;

  -- Orden de bloqueos: suscripción -> pago (el mismo que record_mp_payment y que un borrado en cascada).
  select subscription_id into v_sid from public.payments where id = p_payment_id;
  if not found then raise exception 'Pago no encontrado.'; end if;
  perform 1 from public.subscriptions where id = v_sid for update;
  select * into v_pay from public.payments where id = p_payment_id for update;   -- mismo bloqueo que record_mp_payment
  if not found then raise exception 'Pago no encontrado.'; end if;
  if v_pay.provider <> 'mercadopago' or v_pay.review_reason is null then raise exception 'Ese pago no es un cobro retenido pendiente.'; end if;
  if v_pay.review_resolution is not null then raise exception 'Ese cobro ya fue resuelto.'; end if;
  if v_pay.status <> 'reconciled' or v_pay.applied_at is not null then raise exception 'Ese pago no es un cobro retenido pendiente.'; end if;

  if p_action = 'apply' then
    select * into v_sub from public.subscriptions where id = v_pay.subscription_id for update;
    if not found then raise exception 'Suscripción no encontrada.'; end if;
    select * into v_plan from public.plans where id = v_pay.plan_id;
    if not found then raise exception 'Plan no encontrado.'; end if;
    v_base := greatest(coalesce(v_sub.end_date, public.ar_today()), public.ar_today());
    v_new_end := case when v_plan.billing_period = 'yearly' then (v_base + interval '1 year')::date else (v_base + interval '1 month')::date end;
    update public.subscriptions
       set plan_id = v_plan.id, end_date = v_new_end,
           status = case when v_sub.status = 'cancelled' then 'active' else v_sub.status end,
           cancelled_at = case when v_sub.status = 'cancelled' then null else cancelled_at end
     where id = v_sub.id;
    update public.payments set applied_at = now(), review_resolution = 'applied', reviewed_at = now(), reviewed_by = auth.uid() where id = v_pay.id;
  else
    update public.payments set review_resolution = 'refund_pending', reviewed_at = now(), reviewed_by = auth.uid() where id = v_pay.id;
  end if;

  insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
  values (auth.uid(), 'payments', v_pay.id, 'held_payment_' || p_action,
          jsonb_build_object('reason', v_pay.review_reason, 'notes', p_notes, 'end_date', v_new_end));
  return jsonb_build_object('outcome', 'ok', 'action', p_action, 'end_date', v_new_end);
end;
$$;

create or replace function public.reconcile_transfer_payment(p_payment_id uuid, p_status text, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments%rowtype;
  v_sub public.subscriptions%rowtype;
  v_period text;
  v_base date;
  v_new_end date;
  v_sid uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'No autorizado: solo un administrador puede conciliar.'; end if;
  if p_status not in ('reconciled', 'rejected') then raise exception 'Estado inválido.'; end if;

  -- Orden de bloqueos: suscripción -> pago.
  select subscription_id into v_sid from public.payments where id = p_payment_id;
  if not found then raise exception 'Pago no encontrado.'; end if;
  perform 1 from public.subscriptions where id = v_sid for update;
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
-- Permisos (mínimos)
-- =========================================================
revoke all on function public.mp_user_deletion_hold_active(uuid) from public, anon, authenticated;
revoke all on function public.mp_cleanup_deletion_hold() from public, anon, authenticated;
revoke all on function public.mp_guard_subscription_insert() from public, anon, authenticated;
revoke all on function public.mp_guard_payment_insert() from public, anon, authenticated;
revoke all on function public.mp_begin_user_deletion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mp_end_user_deletion_hold(uuid) from public, anon, authenticated;
revoke all on function public.mp_guard_subscription_delete() from public, anon, authenticated;
revoke all on function public.mp_expire_intent(uuid) from public, anon, authenticated;
revoke all on function public.sync_mp_mirror() from public, anon, authenticated;
revoke all on function public.record_mp_payment(uuid, uuid, text, text, text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.resolve_held_mp_payment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.reconcile_transfer_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mp_begin_user_deletion(uuid, uuid) to service_role;
grant execute on function public.mp_end_user_deletion_hold(uuid) to service_role;
grant execute on function public.mp_expire_intent(uuid) to service_role;
grant execute on function public.record_mp_payment(uuid, uuid, text, text, text, numeric, text, text) to service_role;
grant execute on function public.resolve_held_mp_payment(uuid, text, text) to authenticated;     -- verifica is_admin() adentro
grant execute on function public.reconcile_transfer_payment(uuid, text, text) to authenticated;  -- verifica is_admin() adentro

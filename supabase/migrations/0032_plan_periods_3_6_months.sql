-- 0032: planes de 3 y 6 meses (períodos 'quarterly' y 'semiannual').
-- No reescribe migraciones ya aplicadas: amplía el CHECK de plans.billing_period y redefine (create or replace) las tres
-- funciones vigentes (versión 0028) que calculan el fin del período. ÚNICO cambio en ellas: el cálculo de v_new_end,
-- que ahora usa public.plan_period_months(...) en lugar de «yearly ? 1 año : 1 mes». Todo lo demás es idéntico a 0028.
-- Un período desconocido hace fallar la operación (nunca se asume mensual).

-- 1) Meses que cubre cada período. Falla ante un valor desconocido.
create or replace function public.plan_period_months(p_period text)
returns integer
language plpgsql immutable set search_path = '' as $$
begin
  case p_period
    when 'monthly' then return 1;
    when 'quarterly' then return 3;
    when 'semiannual' then return 6;
    when 'yearly' then return 12;
    else raise exception 'mp:unsupported_plan_period';
  end case;
end;
$$;

-- 2) CHECK ampliado (se busca el constraint por su definición, igual que en 0023).
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.plans'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%billing_period%';
  if v_name is not null then execute format('alter table public.plans drop constraint %I', v_name); end if;
end $$;
alter table public.plans add constraint plans_billing_period_check
  check (billing_period in ('monthly', 'quarterly', 'semiannual', 'yearly'));

-- 3) Funciones vigentes con el cálculo de período actualizado.
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
    v_new_end := (v_base + make_interval(months => public.plan_period_months(v_plan.billing_period)))::date;
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
    v_new_end := (v_base + make_interval(months => public.plan_period_months(v_plan.billing_period)))::date;
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
    v_new_end := (v_base + make_interval(months => public.plan_period_months(v_period)))::date;
    update public.subscriptions set status = 'active', end_date = v_new_end where id = v_sub.id;
  end if;

  insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
  values (auth.uid(), 'payments', v_pay.id, 'reconcile', jsonb_build_object('status', p_status, 'notes', p_notes, 'end_date', v_new_end));
  return jsonb_build_object('outcome', 'ok', 'status', p_status, 'end_date', v_new_end);
end;
$$;

revoke all on function public.plan_period_months(text) from public, anon, authenticated;

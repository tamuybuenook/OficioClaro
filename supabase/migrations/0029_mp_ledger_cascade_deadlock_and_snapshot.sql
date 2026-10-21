-- 0029_mp_ledger_cascade_deadlock_and_snapshot.sql
-- Etapa 1 — revisión final. Incremental: NO modifica 0022–0028.
--
--  1. Interbloqueo residual: el borrado de una suscripción (suscripción -> ledger por la cascada de FK) contra un UPDATE tardío de una
--     fila CERRADA de mp_preapprovals (ledger -> suscripción por el trigger sync_mp_mirror). La guardia BEFORE DELETE ahora bloquea las
--     filas del ledger con FOR UPDATE NOWAIT: el borrado nunca espera al ledger mientras tiene la suscripción. Si la fila está en uso
--     falla de inmediato con 'mp:ledger_busy' (reintentable); si no, ya la tiene y la cascada no espera.
--  2. Instantánea financiera completa al eliminar (audit_logs) + índices de búsqueda + mp_trace_deleted_payment().

-- =========================================================
-- 1 + 2. Guardia de borrado v3
-- =========================================================
create or replace function public.mp_guard_subscription_delete()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_payments jsonb;
  v_preapprovals jsonb;
begin
  -- Orden global (suscripción ya tomada por este DELETE): para NO invertir el orden ledger -> suscripción de otras
  -- transacciones, el ledger se toma SIN ESPERAR. Nunca hay espera con la suscripción en la mano => no hay ciclo posible.
  begin
    perform 1 from public.mp_preapprovals where subscription_id = old.id order by id for update nowait;
  exception when lock_not_available then
    raise exception 'mp:ledger_busy' using errcode = 'P0001',
      detail = 'Otra operación está actualizando las autorizaciones de esta cuenta. Reintentá en unos segundos.';
  end;

  if exists (select 1 from public.mp_preapprovals
              where subscription_id = old.id and status in ('creating', 'pending', 'authorized', 'paused', 'cancelling')) then
    raise exception 'mp:open_preapproval' using errcode = 'P0001',
      detail = 'La suscripción tiene una autorización de Mercado Pago abierta o con cancelación sin confirmar.';
  end if;
  if exists (select 1 from public.payments
              where subscription_id = old.id
                and (status = 'pending' or (status = 'reconciled' and applied_at is null and review_resolution is null))) then
    raise exception 'mp:pending_payments' using errcode = 'P0001',
      detail = 'La cuenta tiene pagos pendientes, en proceso o retenidos que requieren conciliación.';
  end if;

  -- Instantánea FINANCIERA en la MISMA transacción del borrado. Solo lo necesario para investigar y conciliar:
  -- sin tokens, sin email, sin checkout_url ni comprobantes (proof_url). La moneda no se almacena en payments, pero
  -- record_mp_payment exige ARS antes de registrar cualquier cobro de MP, así que es 'ARS' para los pagos con external_id.
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', id,                       -- = external_reference enviado a MP en los pagos únicos
           'external_id', external_id,             -- id del pago en Mercado Pago
           'provider', provider,
           'amount', amount,
           'currency', case when provider = 'mercadopago' and external_id is not null then 'ARS' end,
           'status', status, 'mp_status', mp_status, 'mp_status_detail', mp_status_detail,
           'plan_id', plan_id,
           'reference', case when provider = 'mercadopago' then reference end,   -- 'preapproval:<id>' en renovaciones
           'applied_at', applied_at, 'created_at', created_at, 'updated_at', updated_at,
           'review_reason', review_reason, 'review_resolution', review_resolution, 'reviewed_at', reviewed_at
         ) order by created_at), '[]'::jsonb)
    into v_payments from public.payments where subscription_id = old.id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id,                               -- = external_reference enviado a MP en la autorización
           'preapproval_id', preapproval_id, 'plan_id', plan_id, 'amount', amount, 'status', status,
           'created_at', created_at, 'closed_at', closed_at
         ) order by created_at), '[]'::jsonb)
    into v_preapprovals from public.mp_preapprovals where subscription_id = old.id;

  if jsonb_array_length(v_payments) > 0 or jsonb_array_length(v_preapprovals) > 0 then
    insert into public.audit_logs(actor_id, entity, entity_id, action, old_value)
    values (null, 'subscriptions', old.id, 'mp_payments_snapshot_on_delete',
            jsonb_build_object('user_id', old.user_id, 'subscription_id', old.id, 'subscription_status', old.status, 'end_date', old.end_date,
                               'payments', v_payments, 'preapprovals', v_preapprovals));
  end if;
  return old;
end;
$$;

-- Búsqueda por identificador (pagos y autorizaciones).
create index if not exists audit_logs_mp_snapshot_payments_idx on public.audit_logs using gin ((old_value -> 'payments') jsonb_path_ops)
  where action = 'mp_payments_snapshot_on_delete';
create index if not exists audit_logs_mp_snapshot_preapprovals_idx on public.audit_logs using gin ((old_value -> 'preapprovals') jsonb_path_ops)
  where action = 'mp_payments_snapshot_on_delete';

-- =========================================================
-- Trazado de un cobro posterior a la eliminación
-- =========================================================
-- p_ref puede ser: id del pago en MP (external_id), external_reference de un pago único (payments.id), id de preapproval de MP
-- o external_reference de la autorización (mp_preapprovals.id). Devuelve la cuenta original y el registro conservado.
create or replace function public.mp_trace_deleted_payment(p_ref text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.audit_logs%rowtype;
  v_pay jsonb;
  v_pre jsonb;
begin
  if p_ref is null or length(p_ref) = 0 or length(p_ref) > 100 then return jsonb_build_object('found', false); end if;
  select * into a from public.audit_logs
   where action = 'mp_payments_snapshot_on_delete'
     and (   old_value -> 'payments' @> jsonb_build_array(jsonb_build_object('external_id', p_ref))
          or old_value -> 'payments' @> jsonb_build_array(jsonb_build_object('payment_id', p_ref))
          or old_value -> 'payments' @> jsonb_build_array(jsonb_build_object('reference', 'preapproval:' || p_ref))
          or old_value -> 'preapprovals' @> jsonb_build_array(jsonb_build_object('preapproval_id', p_ref))
          or old_value -> 'preapprovals' @> jsonb_build_array(jsonb_build_object('id', p_ref)))
   order by created_at desc limit 1;
  if not found then return jsonb_build_object('found', false); end if;
  select e into v_pay from jsonb_array_elements(a.old_value -> 'payments') e
   where e ->> 'external_id' = p_ref or e ->> 'payment_id' = p_ref or e ->> 'reference' = 'preapproval:' || p_ref limit 1;
  select e into v_pre from jsonb_array_elements(a.old_value -> 'preapprovals') e
   where e ->> 'preapproval_id' = p_ref or e ->> 'id' = p_ref limit 1;
  return jsonb_build_object('found', true, 'audit_id', a.id, 'deleted_at', a.created_at,
                            'user_id', a.old_value ->> 'user_id', 'subscription_id', a.entity_id,
                            'payment', v_pay, 'preapproval', v_pre);
end;
$$;

revoke all on function public.mp_guard_subscription_delete() from public, anon, authenticated;
revoke all on function public.mp_trace_deleted_payment(text) from public, anon, authenticated;
grant execute on function public.mp_trace_deleted_payment(text) to service_role;

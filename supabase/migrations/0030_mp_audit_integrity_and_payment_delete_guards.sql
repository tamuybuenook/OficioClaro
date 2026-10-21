-- 0030_mp_audit_integrity_and_payment_delete_guards.sql
-- Etapa 1 — cierre de la revisión de seguridad. Incremental: NO modifica 0022–0029.
--
--  A. audit_logs: un cliente (authenticated/anon) no puede fabricar instantáneas financieras ni acciones administrativas reservadas,
--     ni atribuir una fila a otro usuario, ni escribir old_value (salvo el respaldo legítimo 'discard_draft' de un administrador).
--     Defensa en profundidad: política RESTRICTIVE (no la neutraliza ninguna política permisiva futura) + trigger BEFORE INSERT
--     (no depende de RLS) + revocación de privilegios innecesarios. Las funciones SECURITY DEFINER y service_role no se ven afectadas.
--     Incluye mp_audit_suspicious_snapshots() para diagnosticar filas sospechosas ya existentes (solo lectura).
--  B. Reembolso pendiente: una suscripción con un pago retenido en review_resolution = 'refund_pending' no se puede eliminar.
--  C. payments: se rechazan los borrados directos (mp:direct_payment_delete) y el TRUNCATE; la cascada solo borra pagos ya resueltos,
--     cuya suscripción acaba de ser eliminada por la guardia mp_guard_subscription_delete y con su instantánea ya escrita.

-- =========================================================
-- A. audit_logs
-- =========================================================
-- Privilegios: el cliente solo inserta (y lee por RLS). Nunca actualiza, borra ni trunca el registro de auditoría.
revoke insert on public.audit_logs from anon;
revoke update, delete, truncate on public.audit_logs from anon, authenticated;

-- Acciones reservadas al servidor: instantáneas e incidentes de Mercado Pago y acciones administrativas de eliminación de usuarios.
create or replace function public.audit_logs_client_guard()
returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- Solo para roles de CLIENTE. current_user es el rol EFECTIVO: dentro de una función SECURITY DEFINER es su dueño (p. ej. la guardia
  -- de borrado que escribe la instantánea, o record_mp_payment) y service_role tampoco es cliente. Se compara por nombre a propósito:
  -- pg_has_role(..., 'member') es verdadero para cualquier superusuario y trataría al dueño de las funciones como cliente.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.action ~ '^(mp_|admin_delete_user)' then
    raise exception 'audit:reserved_action' using errcode = 'P0001', detail = 'Esa acción de auditoría está reservada al servidor.';
  end if;
  if new.actor_id is not null and new.actor_id is distinct from auth.uid() then
    raise exception 'audit:actor_mismatch' using errcode = 'P0001', detail = 'actor_id debe ser el usuario autenticado (o nulo).';
  end if;
  -- old_value: el cliente solo escribe new_value. Única excepción vigente: el respaldo de discard_draft_version() (invocada por un administrador).
  if new.old_value is not null
     and not (new.entity = 'price_list_versions' and new.action = 'discard_draft' and new.actor_id is not distinct from auth.uid() and public.is_admin()) then
    raise exception 'audit:old_value_forbidden' using errcode = 'P0001', detail = 'El cliente no puede escribir old_value.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_audit_logs_client_guard on public.audit_logs;
create trigger trg_audit_logs_client_guard before insert on public.audit_logs
  for each row execute function public.audit_logs_client_guard();

-- Política RESTRICTIVE: se combina con AND con cualquier política permisiva (la de 0002 u otra futura).
drop policy if exists audit_logs_client_restrict on public.audit_logs;
create policy audit_logs_client_restrict on public.audit_logs
  as restrictive for insert to authenticated, anon
  with check (
    action !~ '^(mp_|admin_delete_user)'
    and (actor_id is null or actor_id = auth.uid())
    and (old_value is null
         or (entity = 'price_list_versions' and action = 'discard_draft' and actor_id is not distinct from auth.uid() and public.is_admin()))
  );

-- Diagnóstico (solo lectura; no borra ni modifica nada): instantáneas financieras o acciones reservadas con indicios de falsificación.
create or replace function public.mp_audit_suspicious_snapshots()
returns table (audit_id uuid, created_at timestamptz, entity_id uuid, actor_id uuid, action text, reasons text[])
language sql stable security definer set search_path = '' as $$
  select x.audit_id, x.created_at, x.entity_id, x.actor_id, x.action, x.reasons
    from (
      -- 1) Instantáneas: la real la escribe la guardia de borrado (actor nulo), de una suscripción que YA no existe, y sus pagos ya no existen.
      select a.id as audit_id, a.created_at, a.entity_id, a.actor_id, a.action,
             array_remove(array[
               case when a.actor_id is not null then 'actor_id_no_nulo' end,
               case when a.entity is distinct from 'subscriptions' then 'entidad_inesperada' end,
               case when a.old_value is null or jsonb_typeof(a.old_value) <> 'object' then 'old_value_invalido' end,
               case when a.old_value ->> 'subscription_id' is distinct from a.entity_id::text then 'subscription_id_no_coincide' end,
               case when a.old_value ->> 'user_id' is null then 'sin_user_id' end,
               case when jsonb_typeof(a.old_value -> 'payments') is distinct from 'array' then 'payments_invalido' end,
               case when a.new_value is not null then 'new_value_inesperado' end,
               case when exists (select 1 from public.subscriptions s where s.id = a.entity_id) then 'suscripcion_todavia_existe' end,
               case when jsonb_typeof(a.old_value -> 'payments') = 'array' and exists (
                      select 1 from jsonb_array_elements(a.old_value -> 'payments') e
                        join public.payments p on p.provider = 'mercadopago' and p.external_id = e ->> 'external_id') then 'pago_todavia_existe' end
             ], null) as reasons
        from public.audit_logs a
       where a.action = 'mp_payments_snapshot_on_delete'
      union all
      -- 2) Otras acciones reservadas atribuidas a un usuario que no es administrador (el servidor las escribe con actor nulo o administrador).
      select a.id, a.created_at, a.entity_id, a.actor_id, a.action, array['accion_reservada_actor_no_admin']
        from public.audit_logs a
        left join public.profiles p on p.id = a.actor_id
       where a.action ~ '^(mp_|admin_delete_user)' and a.action <> 'mp_payments_snapshot_on_delete'
         and a.actor_id is not null and coalesce(p.role, '') <> 'admin'
    ) x
   where cardinality(x.reasons) > 0
   order by x.created_at
$$;

-- =========================================================
-- B. Guardia de borrado de suscripción: también con reembolso pendiente
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
                and (status = 'pending' or (status = 'reconciled' and applied_at is null and (review_resolution is null or review_resolution = 'refund_pending')))) then
    raise exception 'mp:pending_payments' using errcode = 'P0001',
      detail = 'La cuenta tiene pagos pendientes, en proceso, retenidos o con reembolso pendiente que requieren conciliación.';
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

-- La retención de eliminación informa los mismos pagos por conciliar (incluido el reembolso pendiente).
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
     and (status = 'pending' or (status = 'reconciled' and applied_at is null and (review_resolution is null or review_resolution = 'refund_pending')));

  insert into public.audit_logs(actor_id, entity, entity_id, action, new_value)
  values (p_actor, 'profiles', p_user_id, 'admin_delete_user_hold',
          jsonb_build_object('subscriptions', to_jsonb(v_sub_ids), 'preapprovals_to_cancel', to_jsonb(v_ids), 'payments_to_settle', to_jsonb(v_pending)));
  return jsonb_build_object('subscription_ids', to_jsonb(v_sub_ids), 'preapproval_ids', to_jsonb(v_ids), 'pending_payment_ids', to_jsonb(v_pending));
end;
$$;

-- =========================================================
-- C. payments: borrados directos, cascada y TRUNCATE
-- =========================================================
-- Cómo se distingue la cascada legítima SIN pg_trigger_depth() ni banderas que un cliente pueda fijar: payments.subscription_id es
-- NOT NULL con FK. Si el borrado de un pago llega por la cascada de la suscripción, esa suscripción YA fue eliminada por un comando
-- anterior de la misma transacción (la acción de FK corre después) y esta consulta —con instantánea nueva— ya no la ve. Si la
-- suscripción sigue visible, es un borrado directo. Para fingir una cascada habría que eliminar antes la suscripción, y eso ejecuta
-- mp_guard_subscription_delete (autorizaciones abiertas, pagos pendientes/retenidos/reembolso pendiente + instantánea).
create or replace function public.mp_guard_payment_delete()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.subscriptions s where s.id = old.subscription_id) then
    -- Borrado DIRECTO. Único permitido: una intención de Mercado Pago que nunca produjo un pago (rechazada, sin external_id ni acreditación).
    if old.provider = 'mercadopago' and old.status = 'rejected' and old.external_id is null and old.applied_at is null then
      return old;
    end if;
    raise exception 'mp:direct_payment_delete' using errcode = 'P0001',
      detail = 'Los pagos no se borran directamente: se conservan para investigar y conciliar. Solo se eliminan en cascada con la cuenta, ya resueltos.';
  end if;
  -- CASCADA de una suscripción ya eliminada:
  -- 1) nunca un pago que requiere conciliación o seguimiento (pendiente, retenido o con reembolso pendiente);
  if old.status = 'pending' or (old.status = 'reconciled' and old.applied_at is null and (old.review_resolution is null or old.review_resolution = 'refund_pending')) then
    raise exception 'mp:pending_payments' using errcode = 'P0001',
      detail = 'La cuenta tiene pagos pendientes, en proceso, retenidos o con reembolso pendiente que requieren conciliación.';
  end if;
  -- 2) nunca sin su instantánea (la escribe mp_guard_subscription_delete en el mismo borrado; esto cubre una guardia deshabilitada).
  if not exists (select 1 from public.audit_logs a
                  where a.action = 'mp_payments_snapshot_on_delete' and a.entity_id = old.subscription_id
                    and a.old_value -> 'payments' @> jsonb_build_array(jsonb_build_object('payment_id', old.id))) then
    raise exception 'mp:snapshot_missing' using errcode = 'P0001',
      detail = 'No se elimina un pago sin su instantánea financiera.';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_mp_guard_payment_delete on public.payments;
create trigger trg_mp_guard_payment_delete before delete on public.payments
  for each row execute function public.mp_guard_payment_delete();

-- TRUNCATE no dispara triggers por fila: se rechaza también (incluye TRUNCATE ... CASCADE desde subscriptions/profiles, que alcanza a payments).
create or replace function public.mp_guard_payment_truncate()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'mp:direct_payment_delete' using errcode = 'P0001', detail = 'No se puede vaciar la tabla de pagos.';
end;
$$;
drop trigger if exists trg_mp_guard_payment_truncate on public.payments;
create trigger trg_mp_guard_payment_truncate before truncate on public.payments
  for each statement execute function public.mp_guard_payment_truncate();

revoke delete, truncate on public.payments from anon, authenticated;

-- =========================================================
-- Permisos (mínimos)
-- =========================================================
revoke all on function public.audit_logs_client_guard() from public, anon, authenticated;
revoke all on function public.mp_audit_suspicious_snapshots() from public, anon, authenticated;
revoke all on function public.mp_guard_payment_delete() from public, anon, authenticated;
revoke all on function public.mp_guard_payment_truncate() from public, anon, authenticated;
revoke all on function public.mp_guard_subscription_delete() from public, anon, authenticated;
revoke all on function public.mp_begin_user_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mp_audit_suspicious_snapshots() to service_role;
grant execute on function public.mp_begin_user_deletion(uuid, uuid) to service_role;

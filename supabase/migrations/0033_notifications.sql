-- 0033_notifications.sql — Avisos de suscripción (etapa 7). Aditiva: no modifica tablas ni funciones existentes.
-- NO se aplica sola: ejecutar manualmente (primero en un proyecto de prueba). Ver docs/INFORME_CIERRE_ETAPA7A.md.
-- Sin clave foránea a subscriptions a propósito: no interfiere con las guardas de borrado de 0027–0030 (la clave de
-- deduplicación ya incluye la suscripción). Al borrar el perfil del usuario, sus avisos se borran con él.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid,
  kind text not null check (kind in ('trial_ending','auto_charge_upcoming','renewal_not_authorized','payment_failed',
                                     'manual_due_soon','grace_period','suspended_nonpayment','payment_confirmed')),
  source text not null default 'subscription' check (source in ('subscription','payment')),
  dedupe_key text not null,
  due_date date,
  severity text not null check (severity in ('info','warning','danger')),
  status text not null default 'open' check (status in ('open','dismissed','resolved')),
  action jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  dismissed_at timestamptz,
  -- Para la etapa 8 (correos). En la etapa 7 no se usan: quedan en 'none'.
  email_status text not null default 'none' check (email_status in ('none','pending','sent','failed')),
  email_attempts integer not null default 0,
  email_sent_at timestamptz,
  email_last_error text,
  constraint notifications_dedupe_key_key unique (dedupe_key)
);
create index if not exists notifications_user_open_idx on public.notifications (user_id) where status = 'open';
create index if not exists notifications_email_pending_idx on public.notifications (email_status) where email_status in ('pending','failed');

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
-- El usuario solo LEE sus avisos; el admin puede leer todos. Nadie escribe directo: se hace con las funciones de abajo.
create policy notifications_read_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_read_admin on public.notifications for select to authenticated using (public.is_admin());

-- Descartar un aviso: solo el dueño, solo informativos, solo si siguen abiertos.
create or replace function public.dismiss_notification(p_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  update public.notifications set status = 'dismissed', dismissed_at = now()
   where id = p_id and user_id = auth.uid() and status = 'open' and kind = 'payment_confirmed';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public.dismiss_notification(uuid) from public, anon;
grant execute on function public.dismiss_notification(uuid) to authenticated;

-- Sincroniza los avisos de un usuario con la lista deseada (la calcula la aplicación). Idempotente y atómica:
--  · crea los que faltan (la clave única impide duplicados, aunque corran dos sincronizaciones a la vez);
--  · reabre los que se resolvieron y vuelven a corresponder (nunca los descartados por el usuario);
--  · resuelve los que ya no corresponden. No toca los campos de correo.
-- Solo service_role (servidor / cron).
create or replace function public.sync_notifications(p_user_id uuid, p_desired jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[];
  v_created integer := 0; v_reopened integer := 0; v_resolved integer := 0; v_n integer;
  d jsonb;
begin
  if p_user_id is null then raise exception 'Usuario requerido.'; end if;
  if p_desired is null or jsonb_typeof(p_desired) <> 'array' then raise exception 'La lista de avisos debe ser un arreglo.'; end if;
  if jsonb_array_length(p_desired) > 20 then raise exception 'Demasiados avisos.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('notifications:' || p_user_id::text, 0));

  v_keys := coalesce((select array_agg(e->>'dedupe_key') from jsonb_array_elements(p_desired) e), '{}');

  for d in select * from jsonb_array_elements(p_desired) loop
    insert into public.notifications (user_id, subscription_id, kind, source, dedupe_key, due_date, severity, action, payload)
    values (p_user_id, nullif(d->>'subscription_id','')::uuid, d->>'kind', coalesce(d->>'source','subscription'), d->>'dedupe_key',
            nullif(d->>'due_date','')::date, d->>'severity', d->'action', coalesce(d->'payload','{}'::jsonb))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count; v_created := v_created + v_n;
  end loop;

  -- Una clave ajena (de otro usuario) nunca se toca: todo lo siguiente filtra por user_id.
  update public.notifications set status = 'open', resolved_at = null
   where user_id = p_user_id and status = 'resolved' and dedupe_key = any(v_keys);
  get diagnostics v_reopened = row_count;

  update public.notifications set status = 'resolved', resolved_at = now()
   where user_id = p_user_id and status = 'open' and not (dedupe_key = any(v_keys));
  get diagnostics v_resolved = row_count;

  return jsonb_build_object('created', v_created, 'reopened', v_reopened, 'resolved', v_resolved);
end;
$$;
revoke all on function public.sync_notifications(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_notifications(uuid, jsonb) to service_role;

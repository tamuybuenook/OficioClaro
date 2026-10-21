-- 0022_agenda_jobs.sql
-- PROPUESTA: NO aplicar en producción sin autorización. Ver notas al final.
--
-- La agenda reutiliza `client_jobs` (creada en 0020) en lugar de crear una tabla nueva:
-- así los trabajos programados y el historial de trabajos realizados del cliente son la
-- misma entidad. Los registros existentes ('done') quedan como "Terminado" sin cambios.

-- ---------------------------------------------------------------------------
-- 1. Relajar restricciones que impedían programar trabajos
-- ---------------------------------------------------------------------------
-- Un trabajo puede crearse desde la agenda sin cliente.
alter table client_jobs alter column customer_id drop not null;
-- Un trabajo "pendiente de coordinación" todavía no tiene fecha.
alter table client_jobs alter column job_date drop not null;
-- El único insert existente (addClientJob) siempre envía job_date; la agenda envía null a propósito.
alter table client_jobs alter column job_date drop default;

-- ---------------------------------------------------------------------------
-- 2. Columnas nuevas (todas opcionales o con default: no rompen filas existentes)
-- ---------------------------------------------------------------------------
alter table client_jobs add column start_time time;
alter table client_jobs add column duration_minutes integer
  check (duration_minutes is null or duration_minutes between 5 and 1440);
alter table client_jobs add column address text;
alter table client_jobs add column quote_id uuid references quotes(id) on delete set null;
alter table client_jobs add column rescheduled_count integer not null default 0;
alter table client_jobs add column cancel_reason text;
alter table client_jobs add column updated_at timestamptz not null default now();
-- Las filas previas conservan su fecha de creación como última modificación.
update client_jobs set updated_at = created_at;

-- ---------------------------------------------------------------------------
-- 3. Estados y consistencia fecha/estado
-- ---------------------------------------------------------------------------
-- NOT VALID: se exige a filas nuevas o modificadas, sin escanear las existentes.
-- Después de revisar `select status, count(*) from client_jobs group by 1;` se puede ejecutar:
--   alter table client_jobs validate constraint client_jobs_status_chk;
alter table client_jobs add constraint client_jobs_status_chk
  check (status in ('pending', 'scheduled', 'in_progress', 'done', 'cancelled')) not valid;
alter table client_jobs add constraint client_jobs_schedule_chk
  check (status not in ('scheduled', 'in_progress') or job_date is not null) not valid;
alter table client_jobs add constraint client_jobs_time_needs_date_chk
  check (start_time is null or job_date is not null) not valid;

-- ---------------------------------------------------------------------------
-- 4. Un solo trabajo activo por presupuesto (evita duplicados al repetir la operación)
-- ---------------------------------------------------------------------------
-- Si el trabajo se cancela, el presupuesto puede volver a programarse.
create unique index client_jobs_one_active_per_quote
  on client_jobs (quote_id)
  where quote_id is not null and status <> 'cancelled';

create index client_jobs_agenda_idx on client_jobs (user_id, job_date, start_time);
create index client_jobs_quote_idx on client_jobs (quote_id) where quote_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Integridad de relaciones (la RLS actual solo valida user_id, no a quién pertenece el cliente)
-- ---------------------------------------------------------------------------
create or replace function client_jobs_guard()
returns trigger language plpgsql as $$
declare
  v_owner uuid;
  v_quote record;
begin
  new.updated_at := now();

  if new.customer_id is not null then
    select user_id into v_owner from customers where id = new.customer_id;
    if v_owner is distinct from new.user_id then
      raise exception 'El cliente no pertenece a este profesional.';
    end if;
  end if;

  if new.quote_id is not null then
    select user_id, customer_id, status into v_quote from quotes where id = new.quote_id;
    if not found or v_quote.user_id is distinct from new.user_id then
      raise exception 'El presupuesto no pertenece a este profesional.';
    end if;
    if v_quote.customer_id is distinct from new.customer_id then
      raise exception 'El cliente del trabajo no coincide con el del presupuesto.';
    end if;
    if tg_op = 'INSERT' and v_quote.status <> 'accepted' then
      raise exception 'Solo se puede programar un trabajo desde un presupuesto aceptado.';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_client_jobs_guard
  before insert or update on client_jobs
  for each row execute function client_jobs_guard();

-- ---------------------------------------------------------------------------
-- 6. Presupuestos: conservar la descripción histórica de cada ítem
-- ---------------------------------------------------------------------------
-- unit_price y subtotal ya se copian al agregar el ítem. El nombre, en cambio, se leía
-- de `services` (si el admin lo renombra, cambiaba en presupuestos viejos).
alter table quote_items add column description text;
-- Backfill con el nombre vigente hoy: es lo mejor disponible para ítems anteriores.
update quote_items qi set description = s.name
  from services s where s.id = qi.service_id and qi.description is null;

-- ---------------------------------------------------------------------------
-- NOTAS PARA QUIEN AUTORICE LA MIGRACIÓN
-- * Es aditiva: no borra columnas ni datos. Los `update` (updated_at y description) tocan
--   filas reales; son idempotentes y se pueden revisar antes en un ambiente de prueba.
-- * Consecuencia: customer_id y job_date pasan a admitir NULL. El código existente que
--   lee client_jobs (client-detail.tsx) fue adaptado para mostrar "Sin fecha".
-- * La FK customer_id sigue con ON DELETE CASCADE: borrar un cliente borra sus trabajos
--   (comportamiento previo, ahora también para trabajos agendados).
-- * Reversión: drop trigger/function/index/constraints y columnas nuevas; volver a poner
--   NOT NULL en customer_id/job_date solo es posible si no hay filas con NULL.
-- * Sin esta migración la agenda muestra un aviso y no guarda nada; la presupuestación
--   sigue funcionando (el snapshot de description se omite si la columna no existe).

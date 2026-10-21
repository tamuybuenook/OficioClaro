-- PROPUESTA 0031 — vínculo seguro entre pagos y comprobantes fiscales (ARCA). NO APLICADA. NO está en supabase/migrations.
-- Estado: borrador con pruebas locales (0031_comprobantes_fiscales.propuesta.test.sql). Requiere aprobación antes de aplicarla a cualquier base remota.
--
-- Alcance: SOLO guardar y vincular la referencia a comprobantes emitidos por un sistema externo (NexoFactory, etapa posterior).
-- OficioClaro NO emite facturas ni integra ARCA. Esta tabla no simula emisión: un comprobante solo existe aquí si lo
-- cargó el servicio (service_role) con los datos devueltos por el emisor (número, CAE, vencimiento del CAE).
--
-- Decisiones a confirmar con el contador antes de aplicar (ver docs/PROPUESTA_FACTURACION_FISCAL.md):
--   · plazo de conservación de comprobantes (este diseño NUNCA los borra: sin DELETE, y no se pierden al borrar pagos o usuarios);
--   · tipo de comprobante y tratamiento de IVA por condición del receptor;
--   · si el usuario carga sus propios datos fiscales (hoy: solo administrador).

-- =========================================================
-- A. Validador de CUIT/CUIL (11 dígitos, dígito verificador módulo 11)
-- =========================================================
create or replace function public.billing_valid_cuit(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  w int[] := array[5,4,3,2,7,6,5,4,3,2];
  s int := 0; i int; dv int;
begin
  if p is null or p !~ '^\d{11}$' then return false; end if;
  for i in 1..10 loop s := s + substr(p, i, 1)::int * w[i]; end loop;
  dv := 11 - (s % 11);
  if dv = 11 then dv := 0; end if;
  if dv = 10 then return false; end if;   -- combinación inválida
  return dv = substr(p, 11, 1)::int;
end $$;

-- =========================================================
-- B. Datos fiscales del receptor (opcional por usuario)
-- =========================================================
create table if not exists public.billing_tax_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  legal_name text not null check (length(btrim(legal_name)) > 0),
  tax_id_type text not null check (tax_id_type in ('CUIT', 'CUIL', 'DNI', 'CONSUMIDOR_FINAL')),
  tax_id text,
  iva_condition text not null check (iva_condition in ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_ALCANZADO')),
  address text,
  updated_at timestamptz not null default now(),
  constraint billing_tax_id_ck check (
    (tax_id_type = 'CONSUMIDOR_FINAL' and tax_id is null)
    or (tax_id_type in ('CUIT', 'CUIL') and public.billing_valid_cuit(tax_id))
    or (tax_id_type = 'DNI' and tax_id ~ '^\d{7,8}$')
  )
);
alter table public.billing_tax_profiles enable row level security;
create policy billing_tax_profiles_admin_all on public.billing_tax_profiles for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.billing_tax_profiles from anon, authenticated;
grant select, insert, update on public.billing_tax_profiles to authenticated;   -- RLS: solo admin

-- =========================================================
-- C. Comprobantes: registro propio, sobrevive al borrado de pagos y usuarios
-- =========================================================
create table if not exists public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete set null,   -- el vínculo se pierde, el comprobante NO
  user_id uuid references public.profiles(id) on delete set null,
  payment_snapshot jsonb not null,    -- copia del pago al emitir: id, external_id, provider, amount, plan, applied_at
  receiver_snapshot jsonb not null,   -- copia del receptor al emitir: nombre, tipo/nro de documento, condición IVA
  kind text not null check (kind in ('invoice', 'credit_note')),
  doc_type text not null check (length(btrim(doc_type)) > 0),         -- p.ej. FACTURA_C, NOTA_CREDITO_C (lo define el emisor)
  external_system text not null default 'nexofactory',
  external_id text,                   -- identificador del comprobante en el emisor
  status text not null default 'requested' check (status in ('requested', 'issued', 'failed')),
  point_of_sale integer check (point_of_sale is null or point_of_sale between 1 and 99999),
  number bigint check (number is null or number > 0),
  cae text check (cae is null or cae ~ '^\d{14}$'),
  cae_due_date date,
  issued_at timestamptz,
  total numeric(12,2) not null check (total > 0),
  currency text not null default 'ARS' check (currency = 'ARS'),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un comprobante emitido tiene todos los datos fiscales; uno pendiente o fallido no los tiene.
  constraint billing_documents_issued_ck check (
    (status = 'issued' and point_of_sale is not null and number is not null and cae is not null and cae_due_date is not null and issued_at is not null)
    or (status <> 'issued' and cae is null and issued_at is null)
  )
);
-- Un solo comprobante vivo (pedido o emitido) por pago y tipo; los fallidos se pueden reintentar.
create unique index if not exists billing_documents_one_live_per_payment_uidx
  on public.billing_documents(payment_id, kind) where payment_id is not null and status in ('requested', 'issued');
-- La numeración fiscal no se repite.
create unique index if not exists billing_documents_number_uidx
  on public.billing_documents(external_system, doc_type, point_of_sale, number) where status = 'issued';
create unique index if not exists billing_documents_external_uidx
  on public.billing_documents(external_system, external_id) where external_id is not null;
create index if not exists billing_documents_user_idx on public.billing_documents(user_id);

alter table public.billing_documents enable row level security;
create policy billing_documents_admin_read on public.billing_documents for select using (public.is_admin());
revoke all on public.billing_documents from anon, authenticated;
grant select on public.billing_documents to authenticated;     -- escritura: solo service_role (el servicio que habla con el emisor)

-- Un comprobante emitido es inmutable y nada se borra.
create or replace function public.billing_documents_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'billing:no_delete'; end if;
  if tg_op = 'UPDATE' then
    if old.status = 'issued' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then raise exception 'billing:issued_immutable'; end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_billing_documents_guard on public.billing_documents;
create trigger trg_billing_documents_guard before update or delete on public.billing_documents for each row execute function public.billing_documents_guard();
create or replace function public.billing_documents_no_truncate() returns trigger language plpgsql set search_path = '' as $$ begin raise exception 'billing:no_delete'; end $$;
drop trigger if exists trg_billing_documents_no_truncate on public.billing_documents;
create trigger trg_billing_documents_no_truncate before truncate on public.billing_documents for each statement execute function public.billing_documents_no_truncate();
revoke all on function public.billing_documents_guard() from public, anon, authenticated;
revoke all on function public.billing_documents_no_truncate() from public, anon, authenticated;

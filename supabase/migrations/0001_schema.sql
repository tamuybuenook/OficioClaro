-- 0001_schema.sql
-- Esquema núcleo de OficioClaro. Una vez aplicada, no se modifica:
-- cualquier corrección va en una migración nueva.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- =========================================================
-- PERFILES Y ROLES
-- =========================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'user' check (role in ('user', 'admin')),
  region_id uuid, -- fk agregada abajo (regions se define después)
  unit_value numeric(12,2) not null default 0, -- valor de UT personal
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- ZONAS / AJUSTE REGIONAL
-- =========================================================
create table regions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  adjustment_percent numeric(5,2) not null default 0, -- ej: 10.00 = +10%
  created_at timestamptz not null default now()
);

alter table profiles
  add constraint profiles_region_fk foreign key (region_id) references regions(id);

-- =========================================================
-- OFICIOS / CATEGORÍAS / SERVICIOS
-- =========================================================
create table trades (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (trade_id, name)
);

create table services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  name text not null,
  unit_label text not null default 'Trabajo', -- ej: 'Trabajo', 'm2'
  ut_coefficient numeric(10,3), -- si no es null, precio = coeficiente * UT del usuario
  created_at timestamptz not null default now()
);
create index services_category_idx on services(category_id);
create index services_name_trgm_idx on services using gin (name gin_trgm_ops);

-- =========================================================
-- LISTAS MAESTRAS Y VERSIONADO (inmutable una vez publicada)
-- =========================================================
create table price_lists (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table price_list_versions (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references price_lists(id) on delete cascade,
  version_label text not null, -- ej: 'Octubre 2026'
  status text not null default 'draft' check (status in ('draft', 'published')),
  effective_date date not null,
  published_at timestamptz,
  source_ipc_id uuid, -- fk agregada luego de crear ipc_indexes
  created_at timestamptz not null default now(),
  unique (price_list_id, version_label)
);

create table price_items (
  id uuid primary key default gen_random_uuid(),
  price_list_version_id uuid not null references price_list_versions(id) on delete cascade,
  service_id uuid not null references services(id) on delete restrict,
  base_price numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique (price_list_version_id, service_id)
);

-- Bloquea el update/delete de price_items e price_list_versions publicadas
create or replace function prevent_mutation_if_published()
returns trigger language plpgsql as $$
declare v_status text;
begin
  if TG_TABLE_NAME = 'price_list_versions' then
    if OLD.status = 'published' then
      raise exception 'No se puede modificar una versión publicada (%).', OLD.id;
    end if;
  elsif TG_TABLE_NAME = 'price_items' then
    select status into v_status from price_list_versions where id = OLD.price_list_version_id;
    if v_status = 'published' then
      raise exception 'No se puede modificar un ítem de una versión publicada (%).', OLD.id;
    end if;
  end if;
  return OLD;
end;
$$;

create trigger trg_price_list_versions_immutable
  before update or delete on price_list_versions
  for each row execute function prevent_mutation_if_published();

create trigger trg_price_items_immutable
  before update or delete on price_items
  for each row execute function prevent_mutation_if_published();

-- =========================================================
-- IPC
-- =========================================================
create table ipc_indexes (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  value numeric(6,3) not null, -- variación %, ej 3.500
  published_date date not null,
  status text not null default 'pending' check (status in ('pending', 'applied')),
  applies_to_version_id uuid references price_list_versions(id),
  created_at timestamptz not null default now(),
  unique (year, month)
);

alter table price_list_versions
  add constraint price_list_versions_ipc_fk foreign key (source_ipc_id) references ipc_indexes(id);

-- =========================================================
-- PRECIOS PERSONALIZADOS DEL USUARIO
-- =========================================================
create table user_price_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  custom_price numeric(12,2) not null,
  updated_at timestamptz not null default now(),
  unique (user_id, service_id)
);

-- =========================================================
-- CLIENTES / PRESUPUESTOS
-- =========================================================
create table customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);
create index customers_user_idx on customers(user_id);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
create index quotes_user_idx on quotes(user_id);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  service_id uuid not null references services(id) on delete restrict,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null,
  subtotal numeric(14,2) not null
);

-- =========================================================
-- PLANES / SUSCRIPCIONES / PAGOS / CONCILIACIÓN
-- =========================================================
create table plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price numeric(12,2) not null,
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'yearly')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id uuid not null references plans(id),
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now()
);
create index subscriptions_user_idx on subscriptions(user_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  provider text not null default 'transfer' check (provider in ('transfer', 'mercadopago')),
  amount numeric(12,2) not null,
  reference text, -- nro de operación / transferencia informada
  proof_url text,
  status text not null default 'pending' check (status in ('pending', 'reconciled', 'rejected')),
  external_id text, -- id de Mercado Pago cuando aplique
  created_at timestamptz not null default now()
);

create table bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  reconciled_by uuid references profiles(id),
  status text not null check (status in ('reconciled', 'rejected')),
  notes text,
  created_at timestamptz not null default now()
);

-- =========================================================
-- AUDITORÍA
-- =========================================================
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  entity text not null, -- ej: 'price_items', 'subscriptions'
  entity_id uuid,
  action text not null, -- ej: 'create', 'update', 'publish', 'reconcile'
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs(entity, entity_id);

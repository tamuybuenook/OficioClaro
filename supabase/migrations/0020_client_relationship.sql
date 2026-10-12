-- 0020_client_relationship.sql

-- Presupuestos: estado y número correlativo por profesional (sección 5/7)
alter table quotes add column status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected'));
alter table quotes add column number integer;
alter table quotes add column notes text;

-- Valoración interna del cliente (sección 10): privada, nunca se comparte
alter table customers add column rating smallint check (rating between 1 and 5);
alter table customers add column rating_note text;

-- Artefactos (sección 4): arquitectura preparada, sin obligar campos en la UI todavía
create table appliances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  trade_id uuid references trades(id),
  name text not null,
  brand text,
  model text,
  serial_number text,
  location text,
  install_date date,
  last_maintenance_date date,
  next_maintenance_date date,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now()
);
create index appliances_customer_idx on appliances(customer_id);

-- Trabajos realizados (sección 3): historial por cliente, distinto del presupuesto
create table client_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  appliance_id uuid references appliances(id) on delete set null,
  trade_id uuid references trades(id),
  job_date date not null default current_date,
  description text not null,
  status text not null default 'done',
  price numeric(12,2),
  notes text,
  created_at timestamptz not null default now()
);
create index client_jobs_customer_idx on client_jobs(customer_id, job_date desc);

-- Actividad del cliente (sección 8): historial de interacciones
create table client_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  type text not null,
  description text,
  created_at timestamptz not null default now()
);
create index client_activity_customer_idx on client_activity(customer_id, created_at desc);

-- Notas internas del cliente (sección 9): privadas, nunca se comparten
create table client_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);
create index client_notes_customer_idx on client_notes(customer_id, created_at desc);

alter table appliances enable row level security;
alter table client_jobs enable row level security;
alter table client_activity enable row level security;
alter table client_notes enable row level security;

create policy appliances_own on appliances for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid());
create policy client_jobs_own on client_jobs for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid());
create policy client_activity_own on client_activity for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid());
create policy client_notes_own on client_notes for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid());

grant select, insert, update, delete on appliances, client_jobs, client_activity, client_notes to authenticated;

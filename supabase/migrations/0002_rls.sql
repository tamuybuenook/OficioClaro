-- 0002_rls.sql
-- Activa RLS y define políticas explícitas por rol. No usamos "si es admin,
-- puede todo": cada tabla tiene su propia política de admin.

create or replace function is_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- profiles ----------
alter table profiles enable row level security;

create policy profiles_select_own on profiles
  for select using (id = auth.uid() or is_admin());
create policy profiles_update_own on profiles
  for update using (id = auth.uid() or is_admin());
create policy profiles_insert_own on profiles
  for insert with check (id = auth.uid());

-- ---------- contenido de referencia: lectura pública (autenticada), edición solo admin ----------
alter table regions enable row level security;
alter table trades enable row level security;
alter table categories enable row level security;
alter table services enable row level security;
alter table price_lists enable row level security;
alter table price_list_versions enable row level security;
alter table price_items enable row level security;
alter table ipc_indexes enable row level security;

create policy regions_read on regions for select using (auth.role() = 'authenticated');
create policy regions_admin_write on regions for all using (is_admin()) with check (is_admin());

create policy trades_read on trades for select using (auth.role() = 'authenticated');
create policy trades_admin_write on trades for all using (is_admin()) with check (is_admin());

create policy categories_read on categories for select using (auth.role() = 'authenticated');
create policy categories_admin_write on categories for all using (is_admin()) with check (is_admin());

create policy services_read on services for select using (auth.role() = 'authenticated');
create policy services_admin_write on services for all using (is_admin()) with check (is_admin());

create policy price_lists_read on price_lists for select using (auth.role() = 'authenticated');
create policy price_lists_admin_write on price_lists for all using (is_admin()) with check (is_admin());

-- Usuarios solo ven versiones publicadas; admin ve y edita todo (drafts incluidos)
create policy price_list_versions_read_published on price_list_versions
  for select using (status = 'published' or is_admin());
create policy price_list_versions_admin_write on price_list_versions
  for all using (is_admin()) with check (is_admin());

create policy price_items_read_published on price_items
  for select using (
    is_admin() or exists (
      select 1 from price_list_versions v
      where v.id = price_items.price_list_version_id and v.status = 'published'
    )
  );
create policy price_items_admin_write on price_items for all using (is_admin()) with check (is_admin());

create policy ipc_read on ipc_indexes for select using (auth.role() = 'authenticated');
create policy ipc_admin_write on ipc_indexes for all using (is_admin()) with check (is_admin());

-- ---------- datos propios del usuario ----------
alter table user_price_items enable row level security;
alter table customers enable row level security;
alter table quotes enable row level security;
alter table quote_items enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;

create policy user_price_items_own on user_price_items
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

create policy customers_own on customers
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

create policy quotes_own on quotes
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

-- quote_items no tiene user_id directo: se valida a través del quote padre
create policy quote_items_own on quote_items
  for all using (
    is_admin() or exists (select 1 from quotes q where q.id = quote_items.quote_id and q.user_id = auth.uid())
  )
  with check (
    is_admin() or exists (select 1 from quotes q where q.id = quote_items.quote_id and q.user_id = auth.uid())
  );

create policy subscriptions_own_read on subscriptions
  for select using (user_id = auth.uid() or is_admin());
create policy subscriptions_admin_write on subscriptions
  for insert with check (is_admin());
create policy subscriptions_admin_update on subscriptions
  for update using (is_admin()) with check (is_admin());

create policy payments_own_read on payments
  for select using (
    is_admin() or exists (select 1 from subscriptions s where s.id = payments.subscription_id and s.user_id = auth.uid())
  );
create policy payments_own_insert on payments
  for insert with check (
    exists (select 1 from subscriptions s where s.id = payments.subscription_id and s.user_id = auth.uid())
  );
create policy payments_admin_update on payments
  for update using (is_admin()) with check (is_admin());

-- ---------- solo admin ----------
alter table plans enable row level security;
alter table bank_reconciliations enable row level security;
alter table audit_logs enable row level security;

create policy plans_read on plans for select using (auth.role() = 'authenticated');
create policy plans_admin_write on plans for all using (is_admin()) with check (is_admin());

create policy bank_reconciliations_admin_only on bank_reconciliations
  for all using (is_admin()) with check (is_admin());

create policy audit_logs_admin_read on audit_logs for select using (is_admin());
create policy audit_logs_insert_authenticated on audit_logs
  for insert with check (auth.role() = 'authenticated');

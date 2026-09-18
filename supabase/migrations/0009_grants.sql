-- 0009_grants.sql
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.trades, public.categories, public.services, public.regions, public.price_lists, public.price_list_versions, public.price_items, public.ipc_indexes, public.plans to anon;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

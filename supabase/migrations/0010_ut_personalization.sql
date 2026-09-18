-- 0010_ut_personalization.sql
alter table user_price_items add column custom_ut_coefficient numeric(10,3);
alter table price_list_versions add column reference_ut_value numeric(12,2);
alter table profiles add column last_ipc_applied_id uuid references ipc_indexes(id);

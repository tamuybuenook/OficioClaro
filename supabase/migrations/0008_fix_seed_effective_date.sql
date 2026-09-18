-- 0008_fix_seed_effective_date.sql
alter table price_list_versions disable trigger trg_price_list_versions_immutable;
update price_list_versions set effective_date = '2026-09-01' where version_label = 'Octubre 2026';
alter table price_list_versions enable trigger trg_price_list_versions_immutable;

-- 0011_fix_version_label.sql
-- La versión quedó con version_label="Octubre 2026" pero effective_date=2026-09-01
-- (corrección apurada del Bloque de integración). Se renombra para reflejar la fecha real.
alter table price_list_versions disable trigger trg_price_list_versions_immutable;
update price_list_versions set version_label = 'Septiembre 2026' where version_label = 'Octubre 2026' and effective_date = '2026-09-01';
alter table price_list_versions enable trigger trg_price_list_versions_immutable;

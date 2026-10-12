-- DIAGNÓSTICO DE SOLO LECTURA (no modifica nada). Ejecutar en el SQL Editor de Supabase.
-- Objetivo: confirmar el origen de los precios de las versiones de octubre 2026 y el estado de cada una.

-- 1) Estado de cada versión: origen (IPC o manual), UT de referencia, cantidad de ítems.
select t.name as oficio, v.version_label, v.status, v.effective_date,
       v.reference_ut_value, (v.source_ipc_id is not null) as creada_por_ipc,
       i.value as ipc_pct, count(pi.id) as items
from price_list_versions v
join price_lists pl on pl.id = v.price_list_id
join trades t on t.id = pl.trade_id
left join ipc_indexes i on i.id = v.source_ipc_id
left join price_items pi on pi.price_list_version_id = v.id
group by t.name, v.id, i.value
order by t.name, v.effective_date;

-- 2) Cada precio de octubre comparado con (a) UT × UT maestra a la fecha y (b) versión previa × (1 + IPC).
with oct as (
  select v.id as vid, t.name as oficio, v.effective_date, v.source_ipc_id, i.value as ipc_pct, pl.id as list_id
  from price_list_versions v join price_lists pl on pl.id = v.price_list_id
  join trades t on t.id = pl.trade_id left join ipc_indexes i on i.id = v.source_ipc_id
  where v.effective_date = date '2026-10-01'
)
select o.oficio, s.name as trabajo, s.ut_coefficient,
       pi.base_price as precio_guardado,
       round(s.ut_coefficient * get_master_ut_at(o.effective_date), 2) as ut_x_ut_maestra,
       prev.base_price as precio_version_previa,
       case when o.ipc_pct is not null then round(prev.base_price * (1 + o.ipc_pct/100), 2) end as previo_mas_ipc,
       case
         when pi.base_price = round(s.ut_coefficient * get_master_ut_at(o.effective_date), 2) then 'coincide con UT x UT maestra'
         when o.ipc_pct is not null and pi.base_price = round(prev.base_price * (1 + o.ipc_pct/100), 2) then 'coincide con previo + IPC'
         else 'origen no explicado: revisar'
       end as origen
from oct o
join price_items pi on pi.price_list_version_id = o.vid
join services s on s.id = pi.service_id
left join lateral (
  select p2.base_price from price_items p2 join price_list_versions v2 on v2.id = p2.price_list_version_id
  where v2.price_list_id = o.list_id and v2.status = 'published' and v2.effective_date < o.effective_date and p2.service_id = pi.service_id
  order by v2.effective_date desc limit 1
) prev on true
order by o.oficio, s.name;

-- 3) Historial de UT maestra.
select value, valid_from, valid_to, note from master_ut_history order by valid_from;

-- 4) Políticas que permitían escalar el rol (verificar tras desplegar 0021: debe existir el trigger).
select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;

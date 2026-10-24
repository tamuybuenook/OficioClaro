-- Solo lectura. Ejecutar ANTES de depender de la numeración: muestra números de presupuesto repetidos
-- por profesional (posibles con la numeración anterior count + 1 si se borraron presupuestos).
select user_id, number, count(*) as veces
from quotes
where number is not null
group by user_id, number
having count(*) > 1
order by user_id, number;

-- Presupuestos sin número (anteriores a 0020):
select count(*) as sin_numero from quotes where number is null;

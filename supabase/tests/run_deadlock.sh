#!/usr/bin/env bash
# Estrés de interbloqueos: tres sesiones en paralelo sobre la MISMA suscripción
#   X: actualiza el ledger (trigger espejo: ledger -> suscripción)       [como markCancelling/recordCancelFailure de la app]
#   Y: mp_begin_wind_down + restauración                                  [antes: suscripción -> ledger]
#   Z: record_mp_payment recurrente                                       [antes: ledger sin bloquear]
# Uso: run_deadlock.sh <db> [iteraciones]. Esperado: 0 "deadlock detected".
set -uo pipefail
DB=${1:-oc_mp}; N=${2:-300}
P="psql -h /tmp -p 5433 -U postgres -d $DB -v ON_ERROR_STOP=0 -qAt"
U=$($P -c "select gen_random_uuid()")
$P -c "insert into auth.users(id,email,email_confirmed_at) values ('$U','dl_$RANDOM@t.com', now())" >/dev/null
S=$($P -c "select id from subscriptions where user_id='$U'"); PRO=$($P -c "select id from plans where name='Profesional'")
$P -c "update subscriptions set status='active', plan_id='$PRO', end_date=public.ar_today()+10 where id='$S'" >/dev/null
$P -c "insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values ('$S','$PRO',9000,'DL-PRE-$$','authorized')" >/dev/null
L=$($P -c "select id from mp_preapprovals where preapproval_id='DL-PRE-$$'")
{ for i in $(seq 1 $N); do echo "update mp_preapprovals set last_error='x$i' where id='$L';"; done; } > /tmp/dl_x.sql
{ for i in $(seq 1 $N); do echo "begin; set local role service_role; select mp_begin_wind_down('$S','cancelled',null,null); commit; update mp_preapprovals set status='authorized', closed_at=null where id='$L'; update subscriptions set status='active' where id='$S';"; done; } > /tmp/dl_y.sql
{ for i in $(seq 1 $N); do echo "begin; set local role service_role; select record_mp_payment(null,'$S','DL-PAY-$RANDOM$i','approved',null,9000,'ARS','DL-PRE-$$'); commit;"; done; } > /tmp/dl_z.sql
$P -f /tmp/dl_x.sql > /tmp/dl_x.out 2>&1 &
$P -f /tmp/dl_y.sql > /tmp/dl_y.out 2>&1 &
$P -f /tmp/dl_z.sql > /tmp/dl_z.out 2>&1 &
wait
D=$(cat /tmp/dl_x.out /tmp/dl_y.out /tmp/dl_z.out | grep -ci "deadlock detected")
OTHER=$(cat /tmp/dl_x.out /tmp/dl_y.out /tmp/dl_z.out | grep -i "error" | grep -vci "deadlock")
echo "iteraciones por sesión=$N; interbloqueos detectados=$D; otros errores=$OTHER"
if [ "$D" = "0" ]; then echo "INTERBLOQUEOS: PASS (0)"; else echo "INTERBLOQUEOS: FAIL ($D)"; exit 1; fi

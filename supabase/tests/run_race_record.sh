#!/usr/bin/env bash
# Carrera real (sesiones simultáneas) entre record_mp_payment y la cancelación de la autorización.
# Uso: run_race_record.sh <db>   (la DB debe tener las migraciones aplicadas hasta la versión a probar)
#  T1: el cobro se aprobó ANTES de la cancelación pero se procesa DESPUÉS de que ésta se confirmó -> debe quedar RETENIDO.
#  T2: el cobro ya había leído la autorización cuando llega la cancelación; mientras espera un bloqueo, la cancelación se
#      confirma. Estado final consistente: una cuenta cancelada con su autorización cancelada NO puede quedar 'active'.
set -uo pipefail
DB=${1:-oc_mp}
P="psql -h /tmp -p 5433 -U postgres -d $DB -v ON_ERROR_STOP=0 -qAt"
RC=0; TAG=$RANDOM$RANDOM
setup() { # $1 = sufijo -> imprime "SUB PAYID"
  local U; U=$($P -c "select gen_random_uuid()")
  $P -c "insert into auth.users(id,email,email_confirmed_at) values ('$U','race_$1_$RANDOM@t.com', now())" >/dev/null
  local S; S=$($P -c "select id from subscriptions where user_id='$U'")
  local PRO; PRO=$($P -c "select id from plans where name='Profesional'")
  $P -c "update subscriptions set status='active', plan_id='$PRO', end_date=public.ar_today()+10 where id='$S'" >/dev/null
  $P -c "insert into mp_preapprovals(subscription_id, plan_id, amount, preapproval_id, status) values ('$S','$PRO',9000,'RACE-PRE-$TAG-$1','authorized')" >/dev/null
  echo "$S $PRO"
}
cancel_confirm() { # $1=sub $2=sufijo : cancelación administrativa + confirmación de MP (dos transacciones, como en la app)
  $P <<SQL
begin; set local role service_role; select 'wind_down:'||((mp_begin_wind_down('$1','cancelled',null,null))->>'previous_status'); commit;
update mp_preapprovals set status='cancelled', closed_at=now(), last_error=null where preapproval_id='RACE-PRE-$TAG-$2';
SQL
}
record() { # $1=sub $2=sufijo $3=external
  $P <<SQL
begin; set local role service_role;
select 'record:'||(record_mp_payment(null,'$1','$3','approved',null,9000,'ARS','RACE-PRE-$TAG-$2'))::text;
commit;
SQL
}

# ---------- T1 ----------
read S PRO < <(setup t1)
E=MP-RACE-T1-$RANDOM
( $P -c "begin; select pg_advisory_xact_lock(hashtextextended('mp:$E',0)); select pg_sleep(3); commit;" >/dev/null 2>&1 ) &
CPID=$!; sleep 0.4
record "$S" t1 "$E" > /tmp/race_a.out 2>&1 &
APID=$!; sleep 0.5
BOUT=$(cancel_confirm "$S" t1 2>&1)
wait $CPID; wait $APID
AOUT=$(cat /tmp/race_a.out)
ST=$($P -c "select status from subscriptions where id='$S'"); LS=$($P -c "select status from mp_preapprovals where preapproval_id='RACE-PRE-$TAG-t1'")
HELD=$($P -c "select coalesce(review_reason,'-')||'/'||coalesce(applied_at::text,'-') from payments where external_id='$E'")
echo "T1 cancelación: $BOUT"; echo "T1 cobro: $AOUT"; echo "T1 final: suscripción=$ST ledger=$LS pago(review/applied)=$HELD"
if [ "$ST" = "cancelled" ] && [ "$LS" = "cancelled" ] && echo "$AOUT" | grep -q '"held"' && [ "${HELD#*/}" = "-" ]; then echo "T1: PASS (cobro retenido; cuenta sigue cancelada)"; else echo "T1: FAIL"; RC=1; fi

# ---------- T2 ----------
read S PRO < <(setup t2)
E=MP-RACE-T2-$RANDOM
$P -c "insert into payments(subscription_id,provider,amount,reference,status,external_id,plan_id,mp_status) values ('$S','mercadopago',9000,'preapproval:RACE-PRE-$TAG-t2','pending','$E','$PRO','in_process')" >/dev/null
PAY=$($P -c "select id from payments where external_id='$E'")
( $P -c "begin; select 1 from payments where id='$PAY' for update; select pg_sleep(3); commit;" >/dev/null 2>&1 ) &
CPID=$!; sleep 0.4
record "$S" t2 "$E" > /tmp/race_a.out 2>&1 &
APID=$!; sleep 0.5
START=$(date +%s.%N); BOUT=$(cancel_confirm "$S" t2 2>&1); END=$(date +%s.%N)
wait $CPID; wait $APID
AOUT=$(cat /tmp/race_a.out)
ST=$($P -c "select status from subscriptions where id='$S'"); LS=$($P -c "select status from mp_preapprovals where preapproval_id='RACE-PRE-$TAG-t2'")
echo "T2 cancelación (tardó $(printf %.1f $(echo "$END - $START" | bc)) s): $BOUT"; echo "T2 cobro: $AOUT"; echo "T2 final: suscripción=$ST ledger=$LS"
if [ "$LS" = "cancelled" ] && [ "$ST" != "active" ]; then echo "T2: PASS (la cuenta cancelada no fue reactivada)"; else echo "T2: FAIL (cuenta='$ST' con autorización '$LS': reactivación indebida)"; RC=1; fi

# ---------- T3: alta de autorización simultánea con la retención de eliminación ----------
# A activa la retención y mantiene su transacción abierta; B intenta abrir una autorización: debe esperar y, al confirmarse A, ser RECHAZADA.
read S PRO < <(setup t3)
U3=$($P -c "select user_id from subscriptions where id='$S'")
$P -c "update mp_preapprovals set status='cancelled', closed_at=now() where subscription_id='$S'" >/dev/null
( $P <<SQL >/tmp/race_t3a.out 2>&1
begin; set local role service_role; select 'hold:'||((mp_begin_user_deletion('$U3',null))->>'subscription_ids'); select pg_sleep(2); commit;
SQL
) &
APID=$!; sleep 0.5
START=$(date +%s.%N); BOUT=$($P -c "insert into mp_preapprovals(subscription_id, plan_id, amount, status) values ('$S','$PRO',9000,'creating')" 2>&1); END=$(date +%s.%N)
wait $APID
OPENN=$($P -c "select count(*) from mp_preapprovals where subscription_id='$S' and status in ('creating','pending','authorized','paused','cancelling')")
echo "T3 alta simultánea (esperó $(printf %.1f $(echo "$END - $START" | bc)) s): $BOUT; abiertas=$OPENN"
if echo "$BOUT" | grep -q "mp:renewals_blocked" && [ "$OPENN" = "0" ]; then echo "T3: PASS (alta rechazada por la retención; ninguna autorización abierta)"; else echo "T3: FAIL"; RC=1; fi
$P -c "delete from mp_deletion_holds where user_id='$U3'" >/dev/null

# ---------- T4: el alta ya estaba en curso cuando empieza la eliminación ----------
# B inserta (transacción abierta); A inicia la retención: debe esperar, ver la fila ya confirmada y pasarla a seguimiento.
( $P -c "begin; insert into mp_preapprovals(subscription_id, plan_id, amount, status) values ('$S','$PRO',9000,'creating'); select pg_sleep(2); commit;" >/dev/null 2>&1 ) &
BPID=$!; sleep 0.5
AOUT=$($P <<SQL 2>&1
begin; set local role service_role; select 'begin:'||((mp_begin_user_deletion('$U3',null))->>'preapproval_ids'); commit;
SQL
)
wait $BPID
LS=$($P -c "select status from mp_preapprovals where subscription_id='$S' and status in ('creating','cancelling') limit 1"); HOLD=$($P -c "select exists (select 1 from mp_deletion_holds where user_id='$U3')")
echo "T4 eliminación: $AOUT; fila=$LS hold=$HOLD"
if [ "$LS" = "cancelling" ] && [ "$HOLD" = "t" ]; then echo "T4: PASS (la autorización en curso quedó en seguimiento)"; else echo "T4: FAIL"; RC=1; fi
exit $RC

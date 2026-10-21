#!/usr/bin/env bash
# Carreras REALES (sesiones psql independientes) entre eliminación de usuario, checkout de pago único y webhook (migración 0028).
# Uso: run_deletion_race.sh <db> [N_estres]   (la DB debe tener las migraciones aplicadas hasta 0028)
#  D1  cuenta SIN suscripción: checkout (alta de suscripción) simultáneo con la retención -> rechazado, no queda suscripción.
#  D1b el checkout ya estaba en vuelo (transacción abierta): la retención espera, ve la suscripción y las altas posteriores se rechazan.
#  D2  intención de pago único en vuelo + retención: la retención espera y LISTA la intención como pago por conciliar.
#  D3  cobro aprobado (webhook) + eliminación simultáneos: nunca se pierde el rastro (aplicado+instantánea, o eliminación bloqueada).
#  D4  dos eliminaciones simultáneas: sin error ni interbloqueo, una sola retención.
#  D5  webhook repetido tras un intento fallido de eliminación: idempotente, un solo pago.
#  D6  estrés: cobro vs eliminación en cascada, N pares simultáneos: 0 interbloqueos, invariante respetado.
set -uo pipefail
DB=${1:-oc_mp}; N=${2:-60}
P="psql -h /tmp -p 5433 -U postgres -d $DB -v ON_ERROR_STOP=0 -qAt"
RC=0; TAG=$RANDOM$RANDOM; OUT=$(mktemp -d)
PRO=$($P -c "select id from plans where name='Profesional'")
newuser() { # imprime "USER SUB" (con suscripción activa)
  local U; U=$($P -c "select gen_random_uuid()")
  $P -c "insert into auth.users(id,email,email_confirmed_at) values ('$U','dr_${TAG}_$RANDOM$RANDOM@t.com', now())" >/dev/null
  local S; S=$($P -c "select id from subscriptions where user_id='$U'")
  $P -c "update subscriptions set status='active', plan_id='$PRO', end_date=public.ar_today()+10 where id='$S'" >/dev/null
  echo "$U $S"
}
ok()   { echo "$1: PASS ($2)"; }
bad()  { echo "$1: FAIL ($2)"; RC=1; }

# ---------- D1 ----------
read U S < <(newuser); $P -c "delete from subscriptions where user_id='$U'" >/dev/null
( $P -c "begin; set local role service_role; select mp_begin_user_deletion('$U', null); select pg_sleep(2.5); commit;" >$OUT/d1a 2>&1 ) & A=$!
sleep 0.5
$P -c "insert into subscriptions(user_id,plan_id,status,end_date) values ('$U','$PRO','past_due',public.ar_today()-2)" >$OUT/d1b 2>&1
wait $A
NSUB=$($P -c "select count(*) from subscriptions where user_id='$U'"); HOLD=$($P -c "select count(*) from mp_deletion_holds where user_id='$U'")
if grep -q 'mp:renewals_blocked' $OUT/d1b && [ "$NSUB" = 0 ] && [ "$HOLD" = 1 ]; then ok D1 "alta rechazada; sin suscripción; retención vigente"; else bad D1 "$(cat $OUT/d1b) subs=$NSUB hold=$HOLD"; fi

# ---------- D1b ----------
read U S < <(newuser); $P -c "delete from subscriptions where user_id='$U'" >/dev/null
( $P -c "begin; insert into subscriptions(user_id,plan_id,status,end_date) values ('$U','$PRO','past_due',public.ar_today()-2); select pg_sleep(2.5); commit;" >$OUT/d1ba 2>&1 ) & A=$!
sleep 0.5
START=$(date +%s.%N)
$P -c "begin; set local role service_role; select mp_begin_user_deletion('$U', null); commit;" >$OUT/d1bb 2>&1
END=$(date +%s.%N)
wait $A
NSUB=$($P -c "select count(*) from subscriptions where user_id='$U'")
$P -c "insert into payments(subscription_id,provider,amount,status,plan_id,mp_status) select id,'mercadopago',9000,'pending','$PRO','created' from subscriptions where user_id='$U'" >$OUT/d1bc 2>&1
W=$(printf %.1f $(echo "$END - $START" | bc))
if [ "$NSUB" = 1 ] && grep -q "$(printf '"subscription_ids"')" $OUT/d1bb && grep -q 'mp:renewals_blocked' $OUT/d1bc && awk "BEGIN{exit !($W>1.5)}"; then ok D1b "la retención esperó ${W}s, vio la suscripción en vuelo y bloquea intenciones posteriores"; else bad D1b "subs=$NSUB espera=${W}s $(head -c 300 $OUT/d1bb) / $(cat $OUT/d1bc)"; fi

# ---------- D2 ----------
read U S < <(newuser)
( $P -c "begin; insert into payments(subscription_id,provider,amount,status,plan_id,mp_status) values ('$S','mercadopago',9000,'pending','$PRO','created'); select pg_sleep(2.5); commit;" >$OUT/d2a 2>&1 ) & A=$!
sleep 0.5
$P -c "begin; set local role service_role; select mp_begin_user_deletion('$U', null); commit;" >$OUT/d2b 2>&1
wait $A
IID=$($P -c "select id from payments where subscription_id='$S'")
if grep -q "$IID" $OUT/d2b; then ok D2 "la retención esperó a la intención en vuelo y la lista para conciliar"; else bad D2 "$(head -c 400 $OUT/d2b)"; fi
$P -c "delete from auth.users where id='$U'" >$OUT/d2c 2>&1
if grep -q 'mp:pending_payments' $OUT/d2c && [ "$($P -c "select count(*) from payments where id='$IID'")" = 1 ]; then ok D2b "la eliminación se rechaza y la intención se conserva"; else bad D2b "$(cat $OUT/d2c)"; fi

# ---------- D3 ----------
d3() { # $1 = sufijo ; sesiones: A bloquea la suscripción; B = webhook (record); C = eliminación
  read U S < <(newuser)
  local E=MP-DR-$TAG-$1-$RANDOM
  $P -c "insert into payments(subscription_id,provider,amount,status,plan_id,mp_status) values ('$S','mercadopago',9000,'pending','$PRO','created')" >/dev/null
  local IID; IID=$($P -c "select id from payments where subscription_id='$S'")
  ( $P -c "begin; select 1 from subscriptions where id='$S' for update; select pg_sleep(2); commit;" >/dev/null 2>&1 ) & local A=$!
  sleep 0.4
  ( $P -c "begin; set local role service_role; select 'rec:'||(record_mp_payment('$IID',null,'$E','approved',null,9000,'ARS',null))::text; commit;" >$OUT/d3b_$1 2>&1 ) & local B=$!
  sleep 0.2
  ( $P -c "delete from auth.users where id='$U'" >$OUT/d3c_$1 2>&1 ) & local C=$!
  wait $A $B $C
  D3U=$U; D3S=$S; D3E=$E; D3I=$IID
}
d3 a
APPLIED=$($P -c "select count(*) from payments where external_id='$D3E' and applied_at is not null")
USEREXISTS=$($P -c "select count(*) from auth.users where id='$D3U'")
SNAP=$($P -c "select count(*) from audit_logs where action='mp_payments_snapshot_on_delete' and entity_id='$D3S' and old_value::text like '%$D3E%'")
if grep -q 'deadlock' $OUT/d3b_a $OUT/d3c_a; then bad D3 "interbloqueo"
elif [ "$USEREXISTS" = 0 ] && [ "$SNAP" = 1 ]; then ok D3 "cobro aplicado y cuenta eliminada con instantánea del pago (rastro conservado)"
elif [ "$USEREXISTS" = 1 ] && [ "$APPLIED" = 1 ]; then ok D3 "eliminación bloqueada y cobro aplicado a la cuenta (rastro conservado)"
elif [ "$USEREXISTS" = 1 ] && grep -q 'mp:pending_payments' $OUT/d3c_a; then ok D3 "eliminación bloqueada con el pago aún conciliable"
else bad D3 "user=$USEREXISTS applied=$APPLIED snap=$SNAP $(cat $OUT/d3b_a) $(cat $OUT/d3c_a)"; fi

# ---------- D4 ----------
read U S < <(newuser)
( $P -c "begin; set local role service_role; select mp_begin_user_deletion('$U', null); select pg_sleep(2); commit;" >$OUT/d4a 2>&1 ) & A=$!
sleep 0.4
( $P -c "begin; set local role service_role; select mp_begin_user_deletion('$U', null); commit;" >$OUT/d4b 2>&1 ) & B=$!
wait $A $B
H=$($P -c "select count(*) from mp_deletion_holds where user_id='$U'")
if [ "$H" = 1 ] && ! grep -qiE 'error|deadlock' $OUT/d4a $OUT/d4b; then ok D4 "ambas completaron en serie, una sola retención, sin errores"; else bad D4 "holds=$H $(cat $OUT/d4a $OUT/d4b | head -c 300)"; fi

# ---------- D5 ----------
read U S < <(newuser)
$P -c "insert into payments(subscription_id,provider,amount,status,plan_id,mp_status) values ('$S','mercadopago',9000,'pending','$PRO','created')" >/dev/null
IID=$($P -c "select id from payments where subscription_id='$S'"); E=MP-DR5-$TAG
$P -c "delete from auth.users where id='$U'" >$OUT/d5a 2>&1                       # intento de eliminación fallido (pago pendiente)
R1=$($P -c "begin; set local role service_role; select record_mp_payment('$IID',null,'$E','approved',null,9000,'ARS',null)->>'outcome'; commit;" 2>&1 | head -1)
R2=$($P -c "begin; set local role service_role; select record_mp_payment('$IID',null,'$E','approved',null,9000,'ARS',null)->>'outcome'; commit;" 2>&1 | head -1)
NP=$($P -c "select count(*) from payments where external_id='$E'"); EX=$($P -c "select (end_date)::text from subscriptions where id='$S'")
if grep -q 'mp:pending_payments' $OUT/d5a && [ "$R1" = processed ] && [ "$R2" = duplicate ] && [ "$NP" = 1 ]; then ok D5 "eliminación rechazada; webhook: $R1 y luego $R2; 1 solo pago"; else bad D5 "$(cat $OUT/d5a) r1=$R1 r2=$R2 pagos=$NP"; fi

# ---------- D6 (estrés) ----------
DL=0; INV=0
for i in $(seq 1 "$N"); do
  read U S < <(newuser)
  $P -c "insert into payments(subscription_id,provider,amount,status,plan_id,mp_status) values ('$S','mercadopago',9000,'pending','$PRO','created')" >/dev/null
  IID=$($P -c "select id from payments where subscription_id='$S'"); E=MP-DR6-$TAG-$i
  ( $P -c "begin; set local role service_role; select record_mp_payment('$IID',null,'$E','approved',null,9000,'ARS',null); commit;" >$OUT/s_b_$i 2>&1 ) &
  ( $P -c "delete from auth.users where id='$U'" >$OUT/s_c_$i 2>&1 ) &
  wait
  grep -qi deadlock $OUT/s_b_$i $OUT/s_c_$i && DL=$((DL+1))
  UE=$($P -c "select count(*) from auth.users where id='$U'"); AP=$($P -c "select count(*) from payments where external_id='$E' and applied_at is not null")
  SN=$($P -c "select count(*) from audit_logs where action='mp_payments_snapshot_on_delete' and entity_id='$S' and old_value::text like '%$E%'")
  # invariante: o la cuenta existe (y el pago está aplicado o sigue pendiente), o fue eliminada con instantánea del pago
  if [ "$UE" = 0 ] && [ "$SN" != 1 ]; then INV=$((INV+1)); fi
done
if [ "$DL" = 0 ] && [ "$INV" = 0 ]; then ok D6 "$N pares simultáneos: 0 interbloqueos, 0 pagos sin rastro"; else bad D6 "interbloqueos=$DL pagos_sin_rastro=$INV"; fi
rm -rf "$OUT"; exit $RC

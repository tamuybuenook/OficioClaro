#!/usr/bin/env bash
# Carreras REALES (sesiones psql independientes) de la migración 0030: borrado directo de pagos, cascada de eliminación,
# webhook (record_mp_payment) y actualización tardía del ledger, todo a la vez.
# Uso: run_payment_delete_race.sh <db> [N_estres]
#  R1  borrado directo de un pago aplicado mientras llega el webhook repetido: rechazado, 1 solo pago, el webhook sigue siendo idempotente.
#  R2  borrado directo durante una eliminación de cuenta en curso: rechazado; la eliminación termina con la instantánea del pago.
#  R3  estrés: por iteración 4 sesiones simultáneas (eliminar usuario / webhook que aprueba / borrado directo / update tardío del ledger).
#      Invariante: o la cuenta fue eliminada y su instantánea contiene el pago, o la cuenta y el pago siguen existiendo. Cero interbloqueos.
set -uo pipefail
DB=${1:-oc_mp}; N=${2:-100}
P="psql -h /tmp -p 5433 -U postgres -d $DB -v ON_ERROR_STOP=0 -qAt"
RC=0; TAG=$RANDOM$RANDOM; OUT=$(mktemp -d)
PRO=$($P -c "select id from plans where name='Profesional'")
ok()  { echo "$1: PASS ($2)"; }
bad() { echo "$1: FAIL ($2)"; RC=1; }
newcase() { # imprime "USER SUB LEDGER" (autorización cerrada)
  local U S L
  U=$($P -c "select gen_random_uuid()")
  $P -c "insert into auth.users(id,email,email_confirmed_at) values ('$U','pd_${TAG}_$RANDOM$RANDOM@t.com', now())" >/dev/null
  S=$($P -c "select id from subscriptions where user_id='$U'")
  $P -c "update subscriptions set status='cancelled', plan_id='$PRO', end_date=public.ar_today()+10 where id='$S'" >/dev/null
  L=$($P -c "insert into mp_preapprovals(subscription_id,plan_id,amount,preapproval_id,status,closed_at) values ('$S','$PRO',9000,'PD-$TAG-$RANDOM$RANDOM','cancelled',now()) returning id")
  echo "$U $S $L"
}
rec() { $P -c "begin; set local role service_role; select record_mp_payment('$1',null,'$2','approved',null,9000,'ARS',null)->>'outcome'; commit;" 2>&1; }
$P -c "create or replace function public.zz_test_sleep() returns trigger language plpgsql as \$f\$ begin perform pg_sleep(2.5); return old; end \$f\$" >/dev/null
trap '$P -c "drop trigger if exists zz_test_sleep on public.subscriptions" >/dev/null; $P -c "drop function if exists public.zz_test_sleep()" >/dev/null; rm -rf $OUT' EXIT

# ---------- R1 ----------
read U S L < <(newcase)
$P -c "insert into payments(subscription_id,provider,amount,status,plan_id,mp_status) values ('$S','mercadopago',9000,'pending','$PRO','created')" >/dev/null
PID=$($P -c "select id from payments where subscription_id='$S'"); E=MP-PD1-$TAG
R1=$(rec "$PID" "$E" | head -1)
( rec "$PID" "$E" >$OUT/r1w 2>&1 ) & W=$!
( $P -c "delete from payments where id='$PID'" >$OUT/r1d 2>&1 ) & D=$!
wait $W $D
NP=$($P -c "select count(*) from payments where external_id='$E'")
if grep -q 'mp:direct_payment_delete' $OUT/r1d && [ "$R1" = processed ] && head -1 $OUT/r1w | grep -q duplicate && [ "$NP" = 1 ]; then ok R1 "borrado directo rechazado; webhook: $R1 y luego duplicate; 1 solo pago"; else bad R1 "r1=$R1 webhook=$(head -1 $OUT/r1w) borrado=$(head -c 120 $OUT/r1d) pagos=$NP"; fi

# ---------- R2 ----------
read U S L < <(newcase)
$P -c "insert into payments(subscription_id,provider,amount,status,plan_id,mp_status,external_id,applied_at) values ('$S','mercadopago',9000,'reconciled','$PRO','approved','MP-PD2-$TAG',now())" >/dev/null
PID=$($P -c "select id from payments where subscription_id='$S'")
$P -c "create trigger zz_test_sleep before delete on public.subscriptions for each row execute function public.zz_test_sleep()" >/dev/null
( $P -c "delete from auth.users where id='$U'" >$OUT/r2a 2>&1 ) & A=$!; sleep 1.0
$P -c "delete from payments where id='$PID'" >$OUT/r2b 2>&1
wait $A; $P -c "drop trigger if exists zz_test_sleep on public.subscriptions" >/dev/null
GONE=$($P -c "select count(*) from auth.users where id='$U'")
SNAP=$($P -c "select count(*) from audit_logs where action='mp_payments_snapshot_on_delete' and entity_id='$S' and old_value::text like '%MP-PD2-$TAG%'")
if grep -q 'mp:direct_payment_delete' $OUT/r2b && [ "$GONE" = 0 ] && [ "$SNAP" = 1 ]; then ok R2 "borrado directo rechazado en plena eliminación; la cuenta se eliminó con su instantánea"; else bad R2 "directo=$(head -c 120 $OUT/r2b) usuario_existe=$GONE snapshot=$SNAP eliminación=$(head -c 120 $OUT/r2a)"; fi

# ---------- R3 ----------
DLK=0; UNEXP=0; INV=0
for i in $(seq 1 "$N"); do
  read U S L < <(newcase)
  $P -c "insert into payments(subscription_id,provider,amount,status,plan_id,mp_status) values ('$S','mercadopago',9000,'pending','$PRO','created')" >/dev/null
  PID=$($P -c "select id from payments where subscription_id='$S'"); E=MP-PD3-$TAG-$i
  ( sleep 0.0$((RANDOM%5)); $P -c "delete from auth.users where id='$U'" >$OUT/s_a_$i 2>&1 ) &
  ( sleep 0.0$((RANDOM%5)); rec "$PID" "$E" >$OUT/s_b_$i 2>&1 ) &
  ( sleep 0.0$((RANDOM%5)); $P -c "delete from payments where id='$PID'" >$OUT/s_c_$i 2>&1 ) &
  ( sleep 0.0$((RANDOM%5)); $P -c "update mp_preapprovals set last_error='t', updated_at=now() where id='$L'" >$OUT/s_d_$i 2>&1 ) &
  wait
  grep -qi deadlock $OUT/s_?_$i && DLK=$((DLK+1))
  # errores esperados: guardias de borrado, FK por cuenta ya eliminada, ledger ocupado, intención/suscripción inexistente
  if grep -h 'ERROR' $OUT/s_?_$i | grep -viE 'mp:direct_payment_delete|mp:pending_payments|mp:ledger_busy|mp:intent_not_found|mp:subscription_not_found|foreign key|deadlock' | grep -q .; then UNEXP=$((UNEXP+1)); echo "   inesperado it=$i: $(grep -h ERROR $OUT/s_?_$i | head -2 | tr '\n' ' ')"; fi
  UE=$($P -c "select count(*) from auth.users where id='$U'")
  if [ "$UE" = 0 ]; then
    [ "$($P -c "select count(*) from audit_logs where action='mp_payments_snapshot_on_delete' and entity_id='$S' and old_value::text like '%$PID%'")" = 1 ] || INV=$((INV+1))
  else
    [ "$($P -c "select count(*) from payments where id='$PID'")" = 1 ] || INV=$((INV+1))
  fi
  rm -f $OUT/s_?_$i
done
if [ "$DLK" = 0 ] && [ "$UNEXP" = 0 ] && [ "$INV" = 0 ]; then ok R3 "$N iteraciones x 4 sesiones: 0 interbloqueos, 0 errores inesperados, 0 violaciones del invariante"; else bad R3 "interbloqueos=$DLK inesperados=$UNEXP invariante=$INV"; fi
exit $RC

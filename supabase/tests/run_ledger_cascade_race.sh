#!/usr/bin/env bash
# Interbloqueo residual: borrado en cascada (suscripción -> ledger) vs. UPDATE tardío de una fila CERRADA del ledger (ledger -> suscripción, vía sync_mp_mirror).
# Uso: run_ledger_cascade_race.sh <db> [N_estres] [control]
#   control: la DB está en 0028 (sin la corrección 0029): se ESPERA reproducir el interbloqueo (A) -> PASS si ocurre.
#   normal : la DB tiene 0029: A no debe interbloquearse; B (fila en uso) falla limpio y reintentable; C (estrés) 0 interbloqueos.
# Un trigger de prueba (solo en este script) demora el borrado entre el bloqueo de la suscripción y la cascada: hace determinista la ventana.
set -uo pipefail
DB=${1:-oc_mp}; N=${2:-200}; MODE=${3:-normal}
P="psql -h /tmp -p 5433 -U postgres -d $DB -v ON_ERROR_STOP=0 -qAt"
RC=0; TAG=$RANDOM$RANDOM; OUT=$(mktemp -d)
PRO=$($P -c "select id from plans where name='Profesional'")
ok()  { echo "$1: PASS ($2)"; }
bad() { echo "$1: FAIL ($2)"; RC=1; }
newcase() { # imprime "USER SUB LEDGERROW" (cuenta con una autorización ya CERRADA)
  local U S L
  U=$($P -c "select gen_random_uuid()")
  $P -c "insert into auth.users(id,email,email_confirmed_at) values ('$U','lc_${TAG}_$RANDOM$RANDOM@t.com', now())" >/dev/null
  S=$($P -c "select id from subscriptions where user_id='$U'")
  $P -c "update subscriptions set status='cancelled', plan_id='$PRO', end_date=public.ar_today()+10 where id='$S'" >/dev/null
  L=$($P -c "insert into mp_preapprovals(subscription_id,plan_id,amount,preapproval_id,status,closed_at) values ('$S','$PRO',9000,'LC-$TAG-$RANDOM$RANDOM','cancelled',now()) returning id")
  echo "$U $S $L"
}
$P -c "create or replace function public.zz_test_sleep() returns trigger language plpgsql as \$f\$ begin perform pg_sleep(2.5); return old; end \$f\$" >/dev/null
trap '$P -c "drop trigger if exists zz_test_sleep on public.subscriptions" >/dev/null; $P -c "drop function if exists public.zz_test_sleep()" >/dev/null; rm -rf $OUT' EXIT

# ---------- A: ventana determinista ----------
read U S L < <(newcase)
$P -c "create trigger zz_test_sleep before delete on public.subscriptions for each row execute function public.zz_test_sleep()" >/dev/null
( $P -c "delete from auth.users where id='$U'" >$OUT/a_d 2>&1 ) & D=$!
sleep 0.8
( $P -c "update mp_preapprovals set last_error='tardio', updated_at=now() where id='$L'" >$OUT/a_u 2>&1 ) & Uu=$!
wait $D $Uu
$P -c "drop trigger if exists zz_test_sleep on public.subscriptions" >/dev/null
DL=0; grep -qi 'deadlock' $OUT/a_d $OUT/a_u && DL=1
GONE=$($P -c "select count(*) from auth.users where id='$U'")
echo "A borrado: $(head -c 200 $OUT/a_d | tr '\n' ' ')"; echo "A update tardío: $(head -c 200 $OUT/a_u | tr '\n' ' ')"
if [ "$MODE" = control ]; then
  if [ "$DL" = 1 ]; then ok A "interbloqueo REPRODUCIDO en 0028 (control)"; else bad A "no se reprodujo en el control"; fi
else
  if [ "$DL" = 0 ] && [ "$GONE" = 0 ]; then ok A "sin interbloqueo; el borrado terminó y el update tardío no encontró fila"; else bad A "deadlock=$DL usuario_existe=$GONE"; fi
fi

if [ "$MODE" != control ]; then
# ---------- B: fila del ledger en uso por otra transacción: el borrado falla limpio, sin esperar ----------
read U S L < <(newcase)
( $P -c "begin; select 1 from mp_preapprovals where id='$L' for update; select pg_sleep(2.5); commit;" >/dev/null 2>&1 ) & H=$!
sleep 0.5
START=$(date +%s.%N); $P -c "delete from auth.users where id='$U'" >$OUT/b_d 2>&1; END=$(date +%s.%N)
wait $H
W=$(printf %.1f $(echo "$END - $START" | bc)); EX=$($P -c "select count(*) from auth.users where id='$U'")
$P -c "delete from auth.users where id='$U'" >$OUT/b_r 2>&1; GONE=$($P -c "select count(*) from auth.users where id='$U'")
if grep -q 'mp:ledger_busy' $OUT/b_d && awk "BEGIN{exit !($W<1.0)}" && [ "$EX" = 1 ] && [ "$GONE" = 0 ]; then ok B "falló en ${W}s con mp:ledger_busy, todo intacto; el reintento posterior sí borra"; else bad B "espera=${W}s existe=$EX reintento_borrado=$GONE $(cat $OUT/b_d | head -c 200)"; fi

# ---------- C: estrés (sin trigger de prueba): borrado vs. varios updates tardíos, con jitter ----------
DLK=0; ERR=0; LEFT=0
for i in $(seq 1 "$N"); do
  read U S L < <(newcase)
  ( sleep 0.0$((RANDOM%6)); $P -c "delete from auth.users where id='$U'" >$OUT/c_d_$i 2>&1 ) &
  for k in 1 2 3; do ( sleep 0.0$((RANDOM%6)); $P -c "update mp_preapprovals set last_error='t$k', updated_at=now() where id='$L'" >$OUT/c_u${k}_$i 2>&1 ) & done
  wait
  grep -qi deadlock $OUT/c_*_$i && DLK=$((DLK+1))
  grep -qiE 'error' $OUT/c_*_$i && ! grep -qiE 'deadlock|ledger_busy' $OUT/c_*_$i && ERR=$((ERR+1))
  # la cuenta debe haberse borrado salvo que el borrado haya fallado limpio con ledger_busy (reintentable)
  if [ "$($P -c "select count(*) from auth.users where id='$U'")" = 1 ]; then
    if grep -q ledger_busy $OUT/c_d_$i; then $P -c "delete from auth.users where id='$U'" >/dev/null 2>&1; fi
    [ "$($P -c "select count(*) from auth.users where id='$U'")" = 1 ] && LEFT=$((LEFT+1))
  fi
  rm -f $OUT/c_*_$i
done
if [ "$DLK" = 0 ] && [ "$ERR" = 0 ] && [ "$LEFT" = 0 ]; then ok C "$N iteraciones x (1 borrado + 3 updates): 0 interbloqueos, 0 otros errores, 0 cuentas sin borrar tras reintento"; else bad C "interbloqueos=$DLK otros_errores=$ERR sin_borrar=$LEFT"; fi
fi
exit $RC

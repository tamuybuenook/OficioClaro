#!/usr/bin/env bash
# Concurrencia real (dos sesiones) de reconcile_transfer_payment sobre la DB oc_mp creada por run_mercadopago.sh.
# Esperado: exactamente UNA sesión concilia; la otra recibe "ya fue resuelto"; la suscripción se extiende una sola vez.
set -uo pipefail
P="psql -h /tmp -p 5433 -U postgres -d oc_mp -v ON_ERROR_STOP=0 -qAt"
ADM=00000000-0000-0000-0000-0000000000c7
SUB=$($P -c "select id from subscriptions where user_id='00000000-0000-0000-0000-0000000000c8'")
$P -c "insert into payments(id,subscription_id,provider,amount,reference,status,plan_id) values ('00000000-0000-0000-0000-00000000e0cc','$SUB','transfer',9000,'conc','pending',(select plan_id from subscriptions where id='$SUB'))" >/dev/null
BEFORE=$($P -c "select end_date from subscriptions where id='$SUB'")
call() { $P <<SQL 2>&1
begin;
select set_config('request.jwt.claim.sub','$ADM',true), set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select 'OK:'||(public.reconcile_transfer_payment('00000000-0000-0000-0000-00000000e0cc','reconciled','conc'))::text;
select pg_sleep($1);
commit;
SQL
}
call 2 > /tmp/conc_a.out 2>&1 &
APID=$!
sleep 0.4
START=$(date +%s.%N); B=$(call 0); END=$(date +%s.%N); wait $APID
A=$(cat /tmp/conc_a.out)
AFTER=$($P -c "select end_date from subscriptions where id='$SUB'")
RECS=$($P -c "select count(*) from bank_reconciliations where payment_id='00000000-0000-0000-0000-00000000e0cc'")
echo "sesión A: $A"; echo "sesión B (esperó $(printf %.1f $(echo "$END - $START" | bc)) s por el bloqueo): $B"
echo "end_date antes=$BEFORE después=$AFTER; registros de conciliación=$RECS"
EXP=$($P -c "select (greatest('$BEFORE'::date, public.ar_today()) + interval '1 month')::date")
RC=0
if [ "$RECS" = "1" ] && [ "$AFTER" = "$EXP" ]; then echo "CONCURRENCIA transferencias: PASS (se extendió una sola vez)"; else echo "CONCURRENCIA transferencias: FAIL"; RC=1; fi

# ---- Escenario 2: dos admins resuelven a la vez el MISMO cobro retenido (apply) ----
HELD=00000000-0000-0000-0000-00000000e0dd
HSUB=$($P -c "select subscription_id from payments where id='$HELD'")
HBEFORE=$($P -c "select end_date from subscriptions where id='$HSUB'")
callh() { $P <<SQL 2>&1
begin;
select set_config('request.jwt.claim.sub','$ADM',true), set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select 'OK:'||(public.resolve_held_mp_payment('$HELD','apply','conc'))::text;
select pg_sleep($1);
commit;
SQL
}
callh 2 > /tmp/conc_h1.out 2>&1 &
HPID=$!
sleep 0.4
H2=$(callh 0); wait $HPID
H1=$(cat /tmp/conc_h1.out)
HAFTER=$($P -c "select end_date from subscriptions where id='$HSUB'")
HAUD=$($P -c "select count(*) from audit_logs where entity_id='$HELD' and action='held_payment_apply'")
HEXP=$($P -c "select (greatest('$HBEFORE'::date, public.ar_today()) + interval '1 month')::date")
echo "sesión A: $H1"; echo "sesión B: $H2"
echo "end_date antes=$HBEFORE después=$HAFTER; auditorías=$HAUD"
if [ "$HAUD" = "1" ] && [ "$HAFTER" = "$HEXP" ] && echo "$H2" | grep -q "ya fue resuelto"; then echo "CONCURRENCIA cobro retenido: PASS (se aplicó una sola vez)"; else echo "CONCURRENCIA cobro retenido: FAIL"; RC=1; fi
exit $RC

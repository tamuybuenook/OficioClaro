#!/usr/bin/env bash
# Etapa 1 (transferencias): pruebas SQL + concurrencia real con sesiones paralelas. Requiere el Postgres local de run_baseline.sh.
set -euo pipefail
D="$(dirname "$0")"
DB=oc_transfer
P="psql -h /tmp -p 5433 -U postgres -d $DB -X -A -t -q"
bash "$D/run_baseline.sh" $DB 9999
psql -h /tmp -p 5433 -U postgres -d $DB -f "$D/08_transfer_approval.sql" 2>&1

echo "===== CONCURRENCIA: 8 aprobaciones simultáneas del MISMO pago ====="
PID=00000000-0000-0000-0000-00000000c0c0
ADM=00000000-0000-0000-0000-0000000000c3
SUB=$($P -c "select subscription_id from payments where id='$PID'")
BEFORE=$($P -c "select end_date from subscriptions where id='$SUB'")
rm -f /tmp/conc.*.out
for i in 1 2 3 4 5 6 7 8; do
  ( $P -c "set request.jwt.claim.sub='$ADM'; set request.jwt.claim.role='authenticated'; set role authenticated; select 'OK' from (select reconcile_transfer_payment('$PID','reconciled','conc $i')) x" > /tmp/conc.$i.out 2>&1 || true ) &
done
wait
OKS=$(cat /tmp/conc.*.out | grep -c '^OK$' || true)
FAILS=$(cat /tmp/conc.*.out | grep -c 'ya fue resuelto' || true)
RECS=$($P -c "select count(*) from bank_reconciliations where payment_id='$PID'")
AFTER=$($P -c "select end_date from subscriptions where id='$SUB'")
EXPECT=$($P -c "select (greatest('$BEFORE'::date, ar_today()) + interval '1 month')::date")
echo "aprobaciones exitosas: $OKS | rechazadas por 'ya fue resuelto': $FAILS | conciliaciones: $RECS | vigencia antes/después/esperada: $BEFORE / $AFTER / $EXPECT"
if [ "$OKS" = "1" ] && [ "$FAILS" = "7" ] && [ "$RECS" = "1" ] && [ "$AFTER" = "$EXPECT" ]; then echo "PASS  concurrencia: una sola aprobación y una sola extensión"; else echo "FAIL  concurrencia"; exit 1; fi

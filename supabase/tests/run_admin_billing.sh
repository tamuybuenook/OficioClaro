#!/usr/bin/env bash
# Pruebas SQL del panel de facturación (solo lectura). Requiere el Postgres local de run_baseline.sh.
set -euo pipefail
D="$(dirname "$0")"
bash "$D/run_baseline.sh" oc_panel 9999
psql -h /tmp -p 5433 -U postgres -d oc_panel -f "$D/04_admin_billing_panel.sql" 2>&1

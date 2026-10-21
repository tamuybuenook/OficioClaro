#!/usr/bin/env bash
set -euo pipefail
D="$(dirname "$0")"
"$D/run_baseline.sh" oc_plans 9999
psql -h /tmp -p 5433 -U postgres -d oc_plans -f "$D/05_plan_periods.sql" 2>&1

#!/usr/bin/env bash
set -euo pipefail
D="$(dirname "$0")"
"$D/run_baseline.sh" oc_accept 9999
psql -h /tmp -p 5433 -U postgres -d oc_accept -f "$D/01_acceptance.sql" 2>&1

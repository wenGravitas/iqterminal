#!/usr/bin/env bash
set -eu
cd /home/daz/workarea/iqterminal-perf-history
pnpm exec vitest run --maxWorkers=1 > artifacts/pi-history-r1/verified-wall-revisions-r1/full-tests-final.log 2>&1
bash artifacts/pi-history-r1/verified-wall-revisions-r1/build-ui.sh

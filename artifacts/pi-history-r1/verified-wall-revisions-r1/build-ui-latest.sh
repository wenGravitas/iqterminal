#!/usr/bin/env bash
set -eu
cd /home/daz/workarea/iqterminal-perf-history
pnpm exec tsc --noEmit > artifacts/pi-history-r1/verified-wall-revisions-r1/typecheck-latest.log 2>&1
VITE_BUILD_COMMIT=4615dcf62533690654dc094529b4c3956356d74a VITE_DATA_MODE=direct VITE_HISTORY_TILES=0 VITE_DIAGNOSTICS=1 pnpm exec vite build --outDir artifacts/pi-history-r1/verified-wall-revisions-r1/dist --emptyOutDir > artifacts/pi-history-r1/verified-wall-revisions-r1/build-latest.log 2>&1
IQ_HISTORY_CAPTURE_DIR=/home/daz/workarea/iqterminal-perf-history/artifacts/pi-history-r1/verified-wall-revisions-r1 pnpm exec playwright test --config artifacts/pi-history-r1/verified-wall-revisions-r1/browser-latest.config.ts --grep 'current snapshot tooltip|wall value patches|Fit Walls' > artifacts/pi-history-r1/verified-wall-revisions-r1/browser-latest.log 2>&1

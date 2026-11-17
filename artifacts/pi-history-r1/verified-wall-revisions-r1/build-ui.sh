#!/usr/bin/env bash
set -eu
cd /home/daz/workarea/iqterminal-perf-history
pnpm exec tsc --noEmit > artifacts/pi-history-r1/verified-wall-revisions-r1/typecheck-build.log 2>&1
VITE_BUILD_COMMIT=022c39c2af203f6fd6b07bf182c336a8ddd6fba5 VITE_DATA_MODE=direct VITE_HISTORY_TILES=0 VITE_DIAGNOSTICS=1 pnpm exec vite build --outDir artifacts/pi-history-r1/verified-wall-revisions-r1/dist --emptyOutDir > artifacts/pi-history-r1/verified-wall-revisions-r1/build-final.log 2>&1
IQ_HISTORY_CAPTURE_DIR=/home/daz/workarea/iqterminal-perf-history/artifacts/pi-history-r1/verified-wall-revisions-r1 pnpm exec playwright test --config artifacts/pi-history-r1/verified-wall-revisions-r1/browser.config.ts > artifacts/pi-history-r1/verified-wall-revisions-r1/browser-final.log 2>&1

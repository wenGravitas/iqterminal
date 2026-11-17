#!/usr/bin/env bash
set -eu
cd /home/daz/workarea/iqterminal-perf-history
VITE_BUILD_COMMIT=ec670d9f82ea1f25a06deb18318984871f60bf46 VITE_DATA_MODE=direct VITE_HISTORY_TILES=0 VITE_DIAGNOSTICS=1 pnpm exec vite build --outDir artifacts/pi-history-r1/wall-horizon-r1/dist --emptyOutDir > artifacts/pi-history-r1/wall-horizon-r1/build-ui.log 2>&1
IQ_HISTORY_CAPTURE_DIR=/home/daz/workarea/iqterminal-perf-history/artifacts/pi-history-r1/wall-horizon-r1 pnpm exec playwright test --config artifacts/pi-history-r1/wall-horizon-r1/browser.config.ts --grep 'historical archive gaps' > artifacts/pi-history-r1/wall-horizon-r1/browser.log 2>&1

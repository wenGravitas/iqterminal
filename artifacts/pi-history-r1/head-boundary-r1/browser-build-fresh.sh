#!/usr/bin/env bash
set -eu
/home/daz/workarea/iqterminal-server-perf-history/node_modules/.bin/esbuild artifacts/pi-history-r1/head-boundary-r1/browser-entry.ts --bundle --format=esm --platform=browser '--define:import.meta.env={"VITE_HISTORY_TILES":"1","VITE_DATA_MODE":"staging","DEV":false,"PROD":true}' --outfile=artifacts/pi-history-r1/head-boundary-r1/browser-client-fresh.mjs
node artifacts/pi-history-r1/head-boundary-r1/browser-fresh.mjs

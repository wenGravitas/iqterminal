#!/usr/bin/env bash
set -euo pipefail
docker compose -p iqterminal-server --project-directory '/opt/iqterminal' -f '/opt/iqterminal/compose.yaml' -f '/home/daz/iqterminal-perf-history/artifacts/pi-history-r1/deploy-34d7939b75e3505726b2f5279c8db27335567a33/rollback-images.yaml' up -d --no-deps app materializer spot-materializer
docker compose -p iqterminal-server -f '/home/daz/iqterminal-perf-history/compose.yaml' -f '/home/daz/iqterminal-perf-history/artifacts/pi-history-r1/deploy-34d7939b75e3505726b2f5279c8db27335567a33/image-override.yaml' stop footprint-materializer spot-footprint-materializer sql-admission

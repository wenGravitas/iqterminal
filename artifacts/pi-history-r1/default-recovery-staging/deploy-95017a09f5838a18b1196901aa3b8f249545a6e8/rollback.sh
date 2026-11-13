#!/usr/bin/env bash
set -euo pipefail
before=$(docker inspect --format '{{.Name}} {{.Id}} {{.State.StartedAt}}' iqterminal-server iqterminal-spot-server)
docker compose -p iqterminal-server --project-directory '/home/daz/iqterminal-perf-history' -f '/home/daz/iqterminal-perf-history/compose.yaml' -f '/home/daz/iqterminal-perf-history/artifacts/pi-history-r1/deploy-95017a09f5838a18b1196901aa3b8f249545a6e8/rollback-images.yaml' up -d --no-deps sql-admission
ready=0
for attempt in $(seq 1 20); do
  if curl --max-time 3 -fsS http://127.0.0.1:18790/health >/dev/null; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ]
docker compose -p iqterminal-server --project-directory '/home/daz/iqterminal-perf-history' -f '/home/daz/iqterminal-perf-history/compose.yaml' -f '/home/daz/iqterminal-perf-history/artifacts/pi-history-r1/deploy-95017a09f5838a18b1196901aa3b8f249545a6e8/rollback-images.yaml' up -d --no-deps footprint-materializer spot-footprint-materializer materializer spot-materializer app
after=$(docker inspect --format '{{.Name}} {{.Id}} {{.State.StartedAt}}' iqterminal-server iqterminal-spot-server)
[ "$before" = "$after" ]
printf '%s\n' "$after"

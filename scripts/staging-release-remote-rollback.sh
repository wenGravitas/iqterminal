#!/usr/bin/env bash
set -euo pipefail

staging_root=${1:?deployment root required}
active_file="$staging_root/active"
previous_file="$staging_root/previous"
[[ -f "$active_file" && -f "$previous_file" ]] || { echo 'No retained previous release is available.' >&2; exit 2; }
IFS=$'\t' read -r active_id active_port active_container active_image active_image_id active_https_port < "$active_file"
IFS=$'\t' read -r previous_id previous_port previous_container previous_image previous_image_id previous_https_port < "$previous_file"
log_file="$staging_root/logs/rollback-$previous_id-$(date +%Y%m%dT%H%M%S).log"
exec > >(tee -a "$log_file") 2>&1
echo "$(date -Is) rollback begin current=$active_id previous=$previous_id"
[[ -n "$previous_id" && -n "$previous_container" ]]
[[ -f "$staging_root/releases/$previous_id/release.json" ]]
state=$(docker inspect "$previous_container" --format '{{.State.Status}}')
if [[ "$state" != running ]]; then docker start "$previous_container" >/dev/null; fi

healthy=false
for _ in $(seq 1 90); do
  state=$(docker inspect "$previous_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')
  if [[ "$state" == healthy ]]; then healthy=true; break; fi
  if [[ "$state" == exited || "$state" == dead ]]; then break; fi
  sleep 1
done
if [[ "$healthy" != true ]]; then docker logs --tail 80 "$previous_container" || true; echo 'Retained release failed its health check; active route unchanged.' >&2; exit 3; fi
curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$previous_port/market-data/v1/health" >/dev/null

tailnet_host=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
tailnet_ip=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["TailscaleIPs"][0])')
switched=false
restore_serve() {
  if [[ "$switched" == true ]]; then tailscale serve --bg --https="$active_https_port" "http://127.0.0.1:$active_port" || true; fi
}
trap restore_serve ERR INT TERM
tailscale serve --bg --https="$previous_https_port" "http://127.0.0.1:$previous_port"
switched=true
public_url="https://$tailnet_host:$previous_https_port"
served=false
for _ in $(seq 1 12); do
  if curl --noproxy '*' --fail --silent --show-error --max-time 10 --resolve "$tailnet_host:$previous_https_port:$tailnet_ip" "$public_url/__staging/release.json" -o /tmp/iqterminal-rollback-probe 2>/dev/null \
     && grep -Fq "$previous_id" /tmp/iqterminal-rollback-probe; then served=true; break; fi
  sleep 2
done
[[ "$served" == true ]] || { echo 'Rollback HTTPS probe failed; restoring the active Serve route.' >&2; exit 4; }
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$active_id" "$active_port" "$active_container" "$active_image" "$active_image_id" "$active_https_port" >"$previous_file.tmp"
mv -f "$previous_file.tmp" "$previous_file"
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$previous_id" "$previous_port" "$previous_container" "$previous_image" "$previous_image_id" "$previous_https_port" >"$active_file.tmp"
mv -f "$active_file.tmp" "$active_file"
switched=false
trap - ERR INT TERM
echo "$(date -Is) rollback success release=$previous_id url=$public_url/ port=$previous_port image=$previous_image imageId=$previous_image_id"
tailscale serve status

#!/usr/bin/env bash
set -euo pipefail

release_id=${1:?release id required}
https_port=${2:?HTTPS port required}
staging_root=${3:?deployment root required}
[[ "$release_id" =~ ^[a-f0-9]{40}-[a-f0-9]{40}(-diag)?$ ]]
[[ "$https_port" =~ ^[0-9]{1,5}$ ]] && (( https_port >= 1024 && https_port <= 65535 ))
release_dir="$staging_root/releases/$release_id"
log_file="$staging_root/logs/$release_id.log"
mkdir -p "$staging_root/logs" "$staging_root/deployments"
exec > >(tee -a "$log_file") 2>&1

echo "$(date -Is) deploy begin release=$release_id"
[[ -f "$release_dir/release.json" && -f "$release_dir/bundle.sha256" ]]
(cd "$release_dir" && sha256sum --status -c bundle.sha256)
manifest=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["releaseId"])' "$release_dir/release.json")
[[ "$manifest" == "$release_id" ]]

active_file="$staging_root/active"
previous_file="$staging_root/previous"
active_id= active_port= active_container= active_image= active_image_id= active_https_port=
previous_id= previous_port= previous_container= previous_image= previous_image_id= previous_https_port=
if [[ -f "$active_file" ]]; then IFS=$'\t' read -r active_id active_port active_container active_image active_image_id active_https_port < "$active_file"; fi
if [[ -f "$previous_file" ]]; then IFS=$'\t' read -r previous_id previous_port previous_container previous_image previous_image_id previous_https_port < "$previous_file"; fi

if [[ -z "$active_id" ]]; then
  serve_state=$(tailscale serve status 2>&1 || true)
  if ! grep -q 'No serve config' <<<"$serve_state"; then
    echo 'Refusing to replace an untracked Tailscale Serve configuration.' >&2; exit 3
  fi
  if ss -ltn 2>/dev/null | grep -Eq "[:.]${https_port}[[:space:]]"; then
    echo "HTTPS port $https_port is already bound by another local service; refusing to claim it." >&2; exit 3
  fi
else
  serve_state=$(tailscale serve status 2>&1 || true)
  if ! grep -Fq "127.0.0.1:$active_port" <<<"$serve_state"; then
    echo 'The existing Serve target differs from the recorded active release; refusing to replace it.' >&2; exit 3
  fi
  if [[ -n "$active_https_port" && "$active_https_port" != "$https_port" ]]; then
    echo "The active release uses HTTPS port $active_https_port; refusing to move it to $https_port during an upgrade." >&2; exit 3
  fi
fi

base_image=$(docker inspect iqterminal-history-api --format '{{.Config.Image}}')
base_image_id=$(docker inspect iqterminal-history-api --format '{{.Image}}')
server_image_id=$(docker inspect iqterminal-server --format '{{.Image}}')
[[ "$base_image_id" == "$server_image_id" ]] || { echo 'Current and historical API containers use different images; refusing to guess a Node runtime base.' >&2; exit 3; }
docker image inspect "$base_image" >/dev/null
tagged_base_image_id=$(docker image inspect "$base_image" --format '{{.Id}}')
[[ "$tagged_base_image_id" == "$base_image_id" ]] || { echo "Runtime image tag $base_image no longer identifies the running API image; refusing to build from a different base." >&2; exit 3; }
base_node=$(docker run --rm --network none --entrypoint node "$base_image" --version)
echo "Backend runtime base image=$base_image imageId=$base_image_id node=$base_node"
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18780/v1/health >/dev/null
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18892/health >/dev/null

candidate_port=
for candidate in 4180 4181 4182; do
  [[ "$candidate" == "$active_port" || "$candidate" == "$previous_port" ]] && continue
  if ! ss -ltn 2>/dev/null | grep -Eq "[:.]${candidate}[[:space:]]"; then candidate_port=$candidate; break; fi
done
[[ -n "$candidate_port" ]] || { echo 'No free release slot among 4180-4182; existing application processes were left unchanged.' >&2; exit 3; }

short_id=${release_id:0:12}
image="iqterminal-staging-web:$release_id"
container="iqterminal-web-$short_id-$candidate_port"
env_file="$staging_root/deployments/$release_id.env"
cat >"$env_file" <<EOF
IQ_RELEASE_ID=$release_id
IQ_RELEASE_DIR=$release_dir
IQ_IMAGE=$image
IQ_CONTAINER_NAME=$container
IQ_BASE_IMAGE=$base_image
IQ_PORT=$candidate_port
EOF
chmod 0444 "$env_file"
project="iqweb-$short_id-$candidate_port"
docker compose --project-name "$project" --file "$release_dir/compose.yaml" --env-file "$env_file" config --quiet
docker compose --project-name "$project" --file "$release_dir/compose.yaml" --env-file "$env_file" up --detach --build --pull never
image_id=$(docker image inspect "$image" --format '{{.Id}}')
echo "Built frontend image=$image imageId=$image_id"

healthy=false
for _ in $(seq 1 90); do
  status=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
  if [[ "$status" == healthy ]]; then healthy=true; break; fi
  if [[ "$status" == exited || "$status" == dead ]]; then break; fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  docker logs --tail 80 "$container" || true
  echo "Candidate container failed health check (state=$status); existing release remains active." >&2
  exit 4
fi
release_check=$(curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$candidate_port/__staging/release.json")
grep -Fq "$release_id" <<<"$release_check"
curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$candidate_port/market-data/v1/health" >/dev/null
curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$candidate_port/market-data/v2/history/health" >/dev/null

tailnet_host=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
tailnet_ip=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["TailscaleIPs"][0])')
switched=false
restore_serve() {
  if [[ "$switched" == true ]]; then
    if [[ -n "$active_id" ]]; then tailscale serve --bg --https="$https_port" "http://127.0.0.1:$active_port" || true
    else tailscale serve --https="$https_port" off || true; fi
  fi
}
trap restore_serve ERR INT TERM
tailscale serve --bg --https="$https_port" "http://127.0.0.1:$candidate_port"
switched=true
public_url="https://$tailnet_host:$https_port"
served=false
for _ in $(seq 1 12); do
  if curl --noproxy '*' --fail --silent --show-error --max-time 10 --resolve "$tailnet_host:$https_port:$tailnet_ip" "$public_url/__staging/release.json" -o "/tmp/iqterminal-release-probe-$short_id" 2>/dev/null \
     && grep -Fq "$release_id" "/tmp/iqterminal-release-probe-$short_id"; then served=true; break; fi
  sleep 2
done
if [[ "$served" != true ]]; then
  echo "Tailnet HTTPS probe failed at $public_url; restoring the previous Serve route." >&2
  tail -c 5000 "$log_file" >&2 || true
  exit 5
fi
curl --noproxy '*' --fail --silent --show-error --max-time 10 --resolve "$tailnet_host:$https_port:$tailnet_ip" "$public_url/market-data/v1/health" >/dev/null

if [[ -n "$active_id" ]]; then
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$active_id" "$active_port" "$active_container" "$active_image" "$active_image_id" "$active_https_port" >"$staging_root/previous.tmp"
  mv -f "$staging_root/previous.tmp" "$previous_file"
fi
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$release_id" "$candidate_port" "$container" "$image" "$image_id" "$https_port" >"$staging_root/active.tmp"
mv -f "$staging_root/active.tmp" "$active_file"
cat >"$staging_root/deployments/$release_id.json.tmp" <<EOF
{"releaseId":"$release_id","frontendImage":"$image","frontendImageId":"$image_id","backendRuntimeBase":"$base_image","backendRuntimeBaseImageId":"$base_image_id","backendMainSource":"$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["backend"]["commit"])' "$release_dir/release.json")","container":"$container","loopbackPort":$candidate_port,"httpsPort":$https_port,"url":"$public_url/","health":"passed","deployedAt":"$(date -Is)"}
EOF
mv -f "$staging_root/deployments/$release_id.json.tmp" "$staging_root/deployments/$release_id.json"
switched=false
trap - ERR INT TERM
if [[ -n "$previous_id" && "$previous_container" != "$active_container" ]]; then docker stop --time 10 "$previous_container" >/dev/null || true; fi
echo "$(date -Is) deploy success release=$release_id url=$public_url/ port=$candidate_port image=$image imageId=$image_id"
tailscale serve status

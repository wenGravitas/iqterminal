#!/usr/bin/env bash
set -eu
# Separate transports and supervisors: a history reconnect must not close live
# sockets. Compression stays disabled because it stalled live handshakes here.
history_port=${IQ_STAGING_HISTORY_PORT:-18780}
current_port=${IQ_STAGING_CURRENT_PORT:-18781}
upstream_port=${IQ_STAGING_UPSTREAM_PORT:-18780}
wall_upstream_port=${IQ_STAGING_WALL_UPSTREAM_PORT:-}
wall_history_port=${IQ_STAGING_WALL_HISTORY_PORT:-18882}
wall_control_port=${IQ_STAGING_WALL_CONTROL_PORT:-18883}
ports=("$history_port" "$current_port" "$upstream_port" "18894")
if [ -n "$wall_upstream_port" ]; then ports+=("$wall_upstream_port" "$wall_history_port" "$wall_control_port"); fi
for port in "${ports[@]}"; do
  if ! [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] || [ "$port" -gt 65535 ] || [ "$port" -lt 1024 ]; then
    echo 'Invalid private staging tunnel port (1024..65535 required).' >&2; exit 2
  fi
done
for binding in "$history_port" "$current_port"; do if [ "$binding" = "18894" ]; then echo "Staging data ports must not reuse Liquidation Map port 18894." >&2; exit 2; fi; done
if [ "$history_port" = "$current_port" ]; then echo 'Staging history/current ports must differ.' >&2; exit 2; fi
if [ -n "$wall_upstream_port" ]; then
  bindings=("$history_port" "$current_port" "$wall_history_port" "$wall_control_port" "18894")
  for ((i=0;i<${#bindings[@]};i++)); do for ((j=i+1;j<${#bindings[@]};j++)); do
    if [ "${bindings[i]}" = "${bindings[j]}" ]; then echo 'Staging local ports must differ.' >&2; exit 2; fi
  done; done
fi
echo "IQTerminal tunnels: history $history_port, live stream $current_port -> staging $upstream_port; Ctrl-C closes all lanes."
if [ -n "$wall_upstream_port" ]; then echo "Prepared walls: history $wall_history_port, control $wall_control_port -> staging $wall_upstream_port."; fi
pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM
supervise() {
  local port=$1 lane=$2 target=${3:-$upstream_port} child='' delay=1 started status
  local -a traffic_class=(-o IPQoS=none)
  stop_lane() {
    trap - EXIT INT TERM
    if [ -n "$child" ]; then kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi
    exit 0
  }
  trap stop_lane EXIT INT TERM
  while true; do
    started=$SECONDS
    ssh -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
      -o ControlMaster=no -o ControlPath=none -o Compression=no \
      -o ServerAliveInterval=15 -o ServerAliveCountMax=3 "${traffic_class[@]}" \
      -L "127.0.0.1:${port}:127.0.0.1:${target}" staging &
    child=$!; status=0
    wait "$child" || status=$?
    child=''
    if [ $((SECONDS-started)) -ge 60 ]; then delay=1; fi
    printf 'IQTerminal %s tunnel exited (%s); retry in %ss. Other lane retained.\n' "$lane" "$status" "$delay" >&2
    sleep "$delay" & child=$!
    wait "$child" || true
    child=''
    if [ "$delay" -lt 30 ]; then delay=$((delay*2)); [ "$delay" -le 30 ] || delay=30; fi
  done
}
supervise "$history_port" history & pids+=("$!")
supervise "$current_port" live & pids+=("$!")
if [ -n "$wall_upstream_port" ]; then
  supervise "$wall_history_port" wall-history "$wall_upstream_port" & pids+=("$!")
  supervise "$wall_control_port" wall-control "$wall_upstream_port" & pids+=("$!")
fi
supervise "18894" liquidation-map "18894" & pids+=("$!")
wait "${pids[@]}"

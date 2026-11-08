#!/usr/bin/env bash
set -eu
# Separate transports and supervisors: a history reconnect must not close live
# sockets. Compression stays disabled because it stalled live handshakes here.
echo 'IQTerminal tunnels: history 18780, live stream 18781 -> staging 18780; Ctrl-C closes both.'
pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM
supervise() {
  local port=$1 lane=$2 child='' delay=1 started status
  local -a traffic_class=()
  if [ "$lane" = history ]; then traffic_class=(-o IPQoS=none); fi
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
      -L "127.0.0.1:${port}:127.0.0.1:18780" staging &
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
supervise 18780 history & pids+=("$!")
supervise 18781 live & pids+=("$!")
wait "${pids[@]}"

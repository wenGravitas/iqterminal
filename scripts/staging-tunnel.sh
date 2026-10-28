#!/usr/bin/env bash
set -eu
# Separate TCP connections keep large history responses from blocking live frames.
# Keep compression disabled: compressed forwarding stalled live handshakes on Tailscale SSH.
echo 'IQTerminal tunnels: history 18780, live stream 18781 -> staging 18780; Ctrl-C closes both.'
pids=()
cleanup() { trap - EXIT INT TERM; kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
for port in 18780 18781; do
  ssh -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -L "127.0.0.1:${port}:127.0.0.1:18780" staging &
  pids+=("$!")
done
wait -n "${pids[@]}"

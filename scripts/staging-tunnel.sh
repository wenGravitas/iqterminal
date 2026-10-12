#!/usr/bin/env bash
set -eu
echo 'IQTerminal tunnel: Pi 127.0.0.1:18780 -> staging 127.0.0.1:18780; Ctrl-C closes it.'
exec ssh -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:18780:127.0.0.1:18780 staging

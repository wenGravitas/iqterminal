#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ "${1:-}" == -- ]]; then shift; fi
release_dir=${1:?Usage: deploy-staging-release.sh <immutable-release-directory>}
release_dir=$(realpath "$release_dir")
staging_host=${IQ_STAGING_SSH_HOST:-staging}
staging_root=${IQ_STAGING_DEPLOY_ROOT:-/opt/iqterminal-frontend}
https_port=${IQ_STAGING_HTTPS_PORT:-8443}

[[ "$staging_host" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Invalid SSH host alias.' >&2; exit 2; }
[[ "$staging_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo 'Deployment root must be an absolute path without shell metacharacters.' >&2; exit 2; }
[[ "$https_port" =~ ^[0-9]{1,5}$ ]] && (( https_port >= 1024 && https_port <= 65535 )) || { echo 'HTTPS port must be between 1024 and 65535.' >&2; exit 2; }
[[ -f "$release_dir/release.json" && -f "$release_dir/Dockerfile" && -f "$release_dir/compose.yaml" ]] || { echo 'Release directory is incomplete.' >&2; exit 2; }
[[ -f "$release_dir/bundle.sha256" ]] || { echo 'Release bundle checksum is missing.' >&2; exit 2; }

release_id=$(node -e "const m=require(process.argv[1]);process.stdout.write(m.releaseId)" "$release_dir/release.json")
[[ "$release_id" =~ ^[a-f0-9]{40}-[a-f0-9]{40}(-diag)?$ ]] || { echo 'Invalid immutable release ID.' >&2; exit 2; }
remote_release="$staging_root/releases/$release_id"
echo "Uploading immutable IQTerminal release $release_id to $staging_host:$remote_release"
local_bundle_hash=$(sha256sum "$release_dir/bundle.sha256" | cut -d' ' -f1)
remote_bundle_hash=$(ssh -o BatchMode=yes "$staging_host" "if [ -f '$remote_release/bundle.sha256' ]; then sha256sum '$remote_release/bundle.sha256' | cut -d' ' -f1; elif [ -e '$remote_release' ]; then printf incomplete; else printf absent; fi")
if [[ "$remote_bundle_hash" == absent ]]; then
  remote_upload="$staging_root/releases/.$release_id.incoming.$$"
  upload_owned=0
  cleanup_upload() {
    if [[ "$upload_owned" == 1 ]]; then ssh -o BatchMode=yes "$staging_host" "sudo -n rm -rf -- '$remote_upload'" >/dev/null 2>&1 || true; fi
  }
  trap cleanup_upload EXIT
  remote_uid=$(ssh -o BatchMode=yes "$staging_host" 'id -u')
  remote_gid=$(ssh -o BatchMode=yes "$staging_host" 'id -g')
  [[ "$remote_uid" =~ ^[0-9]+$ && "$remote_gid" =~ ^[0-9]+$ ]] || { echo 'Could not identify the SSH upload owner.' >&2; exit 2; }
  ssh -o BatchMode=yes "$staging_host" "sudo -n install -d -o root -g root -m 0755 '$staging_root' '$staging_root/releases' '$staging_root/logs' '$staging_root/deployments' && sudo -n mkdir -- '$remote_upload' && sudo -n chown '$remote_uid:$remote_gid' '$remote_upload'"
  upload_owned=1
  tar -C "$release_dir" -czf - . | ssh -o BatchMode=yes "$staging_host" "tar -xzf - -C '$remote_upload'"
  ssh -o BatchMode=yes "$staging_host" "cd '$remote_upload' && sha256sum --status -c bundle.sha256 && sudo -n chown -R root:root '$remote_upload' && sudo -n chmod -R a-w '$remote_upload' && sudo -n mv -T -- '$remote_upload' '$remote_release'"
  upload_owned=0
  trap - EXIT
elif [[ "$remote_bundle_hash" != "$local_bundle_hash" ]]; then
  echo 'Remote release directory is incomplete or has different bundle contents; refusing to overwrite it.' >&2
  exit 2
fi
ssh -o BatchMode=yes "$staging_host" "cd '$remote_release' && sha256sum --status -c bundle.sha256"
ssh -o BatchMode=yes "$staging_host" sudo -n bash -s -- "$release_id" "$https_port" "$staging_root" < "$repo_root/scripts/staging-release-remote-deploy.sh"

echo "Published https://$(ssh -o BatchMode=yes "$staging_host" 'tailscale status --json | python3 -c "import json,sys;print(json.load(sys.stdin)[\"Self\"][\"DNSName\"].rstrip(\".\"))"'):$https_port/"

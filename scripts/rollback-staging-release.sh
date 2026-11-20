#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
staging_host=${IQ_STAGING_SSH_HOST:-staging}
staging_root=${IQ_STAGING_DEPLOY_ROOT:-/opt/iqterminal-frontend}
[[ "$staging_host" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Invalid SSH host alias.' >&2; exit 2; }
[[ "$staging_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo 'Deployment root must be an absolute path without shell metacharacters.' >&2; exit 2; }
ssh -o BatchMode=yes "$staging_host" bash -s -- "$staging_root" < "$repo_root/scripts/staging-release-remote-rollback.sh"

# IQTerminal overnight Luna runner

This is the owner-approved exception for **overnight automation only**. It uses a dedicated Linux runner account and a fresh isolated checkout of the frontend's GitHub `luna-dev` branch. It does not use the Pi's shared `dev` checkout, `main`, the backend, staging services, signed orders, or deployments. Keep the checkout used to install the runner on the dedicated host, outside the Pi's daytime work area. Do not give the account deployment or exchange credentials.

## Before enabling

1. Install Python 3.11+, Git, Node 22.19+ and the repo's pnpm version, and a current Codex CLI. Use a runner account with a writable home. Authenticate the CLI with **the owner's ChatGPT account**, not a billable API key. Use that account's ordinary supported CLI sign-in. Do not copy credentials to another machine. Configure Git identity and noninteractive GitHub credentials for access to this repo. If possible enforce branch permissions so only `luna-dev` can be written by the runner. Confirm GitHub already has `luna-dev`; the runner never creates it or updates any other branch.
2. Copy `scripts/luna/queue.example.json` to e.g. `~/.local/state/iq-luna/queue.json` (directory mode 700, file mode 600). Only the owner/scheduler updates this file with approved jobs. An empty queue makes zero model calls. A job uses an owner-approved unique `id`, a narrow `prompt`, `allow` with exact relative files where possible, and `checks` listing exact existing focused Vitest files (or use [] if the task adds its own). The first approved Key Levels run was a separate pilot; do not silently enqueue it a second time.
3. From the runner installation, run `cd scripts/luna && python3 -m unittest -v test_runner.py`. Then return to the repository root and run:

   ```sh
   python3 scripts/luna/runner.py --state "$HOME/.local/state/iq-luna" --probe --publish
   ```

   This makes one tiny read-only Codex request with **explicit model `gpt-6-luna`, medium**, then checks the auth/push route with Git's `--dry-run` for the already-existing `luna-dev`. No commit/branch change. Without `--publish`, this only probes Codex and cannot approve later publication. An unavailable model/auth or runtime failure blocks the schedule; do not substitute a model. A successful response plus explicit selector verifies the requested configuration; some CLI versions do not report the serving model separately. The runner reports when that field is unavailable.
4. To validate a real first night without publishing, omit `--publish` from the example below. Each launched job, including a failed, no-op, or dry run, is marked attempted in local state; inspect the report and explicitly approve a new ID to retry. No automatic retry or fallback.

## Timer (not enabled by default)

Install a **user** Linux systemd service and timer only after the probe succeeds. Use an isolated runner account and replace the example service paths with verified absolute paths. If needed configure `PATH` in the service. The scheduler doesn't supply authentication; verify it is available in the service account's environment. The host/account manager must stay running overnight; don't turn on linger or install a timer on the Pi as a surprise.

```ini
# ~/.config/systemd/user/iq-luna.service
[Unit]
Description=IQTerminal Luna overnight worker

[Service]
Type=exec
WorkingDirectory=%h/iq-luna-install
ExecStart=/usr/bin/python3 %h/iq-luna-install/scripts/luna/runner.py --state %h/.local/state/iq-luna --queue %h/.local/state/iq-luna/queue.json --publish
RuntimeMaxSec=3h
KillMode=control-group
TimeoutStopSec=5s
UMask=0077
```

```ini
# ~/.config/systemd/user/iq-luna.timer
[Unit]
Description=Start IQTerminal Luna at 20:00 East Africa Time

[Timer]
OnCalendar=*-*-* 20:00:00 Africa/Nairobi
AccuracySec=1s
Persistent=false
Unit=iq-luna.service

[Install]
WantedBy=timers.target
```

Verify `systemd-analyze calendar '*-*-* 20:00:00 Africa/Nairobi'` and the service installation, then activate with `systemctl --user daemon-reload && systemctl --user enable --now iq-luna.timer`. Disable with `systemctl --user disable --now iq-luna.timer`; `systemctl --user stop iq-luna.service` also stops an ongoing run.

## Guardrails and reports

- One process lock, one approved feature (up to 75 minutes) then one approved focused coverage job (up to 60 minutes), in serial. The runner checks the 20:00–05:00 EAT window, reserves shutdown time, and kills timed-out command groups. The systemd service is an independent whole-service hard limit. Its runtime ceiling doesn't force the model to spend the whole window. The time limits are not a hard credit cap.
- The worker receives the paths and scope for one approved job. Feature updates need a passing focused test, typecheck and production build. Coverage only accepts **new** focused Vitest files and runs those tests, so it cannot conceal an existing regression by editing an existing test or product code. It reports bugs instead of fixing unrelated issues. Expand the approved queue explicitly when you want another coverage target. The launcher does not run headed Chromium or assume a reused browser server is valid.
- Ordinary Git fast-forward pushes only, after tests and local cleanliness checks and only with `--publish`. If the remote moved, publication stops. Each run has a local patch when there are verified commits, retained even in non-publication mode. Model events and operation logs are private on the host, never pushed. No changes are automatically merged back or deployed.
- Read the completed report at **`~/.local/state/iq-luna/latest-report.md`**. It updates atomically only after a run resolves; the probe has its own `latest-preflight.md`. Each run also keeps structured JSON, raw notes, checks and any verified patch under `runs/<timestamp>/`. Set up a separate, verified ChatGPT reporting route to this host if desired. This runner does not send a chat message or use an external notifier.

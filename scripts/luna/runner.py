#!/usr/bin/env python3
"""Single-worker IQTerminal rollout; run on a trusted Linux runner account."""
import argparse
from datetime import datetime, time, timedelta
import fcntl
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import subprocess
import tempfile
from zoneinfo import ZoneInfo

MODEL = "gpt-6-luna"
EFFORT = "medium"
REMOTE = "https://github.com/wenGravitas/iqterminal.git"
BRANCH = "luna-dev"
EAT = ZoneInfo("Africa/Nairobi")
TEST_PATH = re.compile(r"^tests/(?!browser/)[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?$")
CHANGE_PATH = re.compile(r"^[A-Za-z0-9_./-]+$")
JOB_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
STOP_LEEWAY = 5


def cutoff(now):
    """05:00 EAT ending the current overnight slot, or None."""
    now = now.astimezone(EAT)
    if now.hour >= 20:
        return datetime.combine(now.date() + timedelta(days=1), time(5), EAT)
    if now.hour < 5:
        return datetime.combine(now.date(), time(5), EAT)
    return None


def remaining(until):
    return (until - datetime.now(EAT)).total_seconds()


def command(argv, *, cwd, until, log=None, stdin=None, env=None):
    seconds = remaining(until) - STOP_LEEWAY
    if seconds <= 0:
        raise TimeoutError("cutoff reached before starting " + argv[0])
    with subprocess.Popen(argv, cwd=cwd, start_new_session=True, env=env,
                          stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                          stdout=log if log is not None else subprocess.PIPE,
                          stderr=log if log is not None else subprocess.PIPE) as process:
        try:
            out, err = process.communicate(input=stdin, timeout=seconds)
        except BaseException:
            # Include tool subprocesses in the termination rather than just killing the CLI.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()
            raise
    if process.returncode:
        detail = (err or b"").decode(errors="replace").strip().splitlines()
        raise RuntimeError(f"{argv[0]} exited {process.returncode}" +
                           (f": {detail[-1]}" if detail else " (see phase log)"))
    return out or b""


def g(repo, until, *args):
    return command(["git", "-c", "core.hooksPath=/dev/null", *args], cwd=repo, until=until,
                   env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})


def state(repo, until):
    result = g(repo, until, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    paths = []
    for item in result.decode().split("\0"):
        if not item:
            continue
        status, path = item[:2], item[3:]
        if status not in {" M", "M ", "MM", "??", "A ", "AM"} or not safe_path(path):
            raise RuntimeError("unexpected git change type or path")
        file = repo / path
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(repo):
            raise RuntimeError("change is not a regular file within the isolated clone")
        if file.stat().st_size > 512 * 1024:
            raise RuntimeError("change exceeds 512 KiB per-file limit")
        paths.append(path)
    if len(paths) > 20:
        raise RuntimeError("too many files changed")
    return sorted(paths)


def fingerprint(repo, paths):
    """Verify contents and file modes, not just status/path names."""
    result = {}
    for path in paths:
        file = repo / path
        result[path] = (stat.S_IMODE(file.stat().st_mode),
                        hashlib.sha256(file.read_bytes()).hexdigest())
    return result


def safe_path(path):
    return bool(CHANGE_PATH.fullmatch(path) and not path.startswith(("/", "-"))
                and not any(p.startswith(".") or p.startswith("-") for p in path.split("/")))


def permitted(path, phase, job, repo, until):
    # Never permit workflow, manifest, config, runner or executable trading changes.
    if any(re.search(r"(?:trade|trading|signing|execution|orders?|wallet)", segment, re.I)
           for segment in PurePosixPath(path).parts):
        return False
    if phase == "coverage":
        return bool(TEST_PATH.fullmatch(path)
                    and any(fnmatch.fnmatchcase(path, pat) for pat in job["allow"])
                    and not g(repo, until, "ls-files", "--", path))
    return ((path.startswith("src/") or TEST_PATH.fullmatch(path))
            and any(fnmatch.fnmatchcase(path, pat) for pat in job["allow"]))


def jobs(config):
    if not isinstance(config, dict) or set(config) - {"feature", "coverage"}:
        raise ValueError("queue must contain only feature and coverage lists")
    result = {}
    for phase in ("feature", "coverage"):
        values = config.get(phase, [])
        if not isinstance(values, list):
            raise ValueError(f"{phase} must be a list")
        seen = set()
        for job in values:
            if (not isinstance(job, dict) or not isinstance(job.get("id"), str) or not JOB_ID.fullmatch(job["id"])
                    or job["id"] in seen or not isinstance(job.get("prompt"), str) or not job["prompt"].strip()
                    or not isinstance(job.get("allow"), list) or not job["allow"]
                    or not all(isinstance(p, str) and p.startswith(("src/", "tests/"))
                               and ".." not in p and not p.startswith("/") for p in job["allow"])
                    or not isinstance(job.get("checks"), list)
                    or not all(isinstance(p, str) and TEST_PATH.fullmatch(p) for p in job["checks"])):
                raise ValueError(f"invalid or duplicate {phase} job")
            seen.add(job["id"])
        result[phase] = values
    return result


def model_command(repo, report, probe=False):
    return ["codex", "-a", "never", "exec", "--ephemeral", "--json",
            "-m", MODEL, "-c", f'model_reasoning_effort="{EFFORT}"', "-c", 'model_provider="openai"',
            "-s", "read-only" if probe else "workspace-write",
            "-C", str(repo), "--output-last-message", str(report), "-"]


def model_environment():
    # Avoid forwarding API keys or deployment secrets from the service environment.
    base = {"HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM",
            "CODEX_HOME", "CODEX_SQLITE_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR",
            "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
            "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR"}
    env = {k: v for k, v in os.environ.items() if k in base}
    env.update({"GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null",
                "GIT_TERMINAL_PROMPT": "0", "CODEX_CI": "1", "LC_ALL": "C"})
    return env


def model(repo, out, phase, prompt, until, probe=False):
    report = out / f"{phase}.md"
    events = out / f"{phase}.events.jsonl"
    stderr = out / f"{phase}.stderr"
    env = model_environment()
    # Check account mode on every actual turn, not only at activation.
    with (out / f"{phase}.login").open("w+b") as log:
        command(["codex", "login", "status"], cwd=repo, until=until, log=log, env=env)
        log.seek(0)
        if b"Logged in using ChatGPT" not in log.read():
            raise RuntimeError("runner needs a ChatGPT CLI login; refusing to use an API key")
    with events.open("wb") as stdout, stderr.open("wb") as errors:
        seconds = remaining(until) - STOP_LEEWAY
        if seconds <= 0:
            raise TimeoutError("too little time to start model")
        # Combine inherited command and assistant process into one process group.
        with subprocess.Popen(model_command(repo, report, probe), cwd=repo, env=env,
                              start_new_session=True, stdin=subprocess.PIPE,
                              stdout=stdout, stderr=errors) as proc:
            try:
                proc.communicate(input=prompt.encode(), timeout=seconds)
            except BaseException:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.communicate()
                raise
        if proc.returncode:
            raise RuntimeError(f"Codex exited {proc.returncode}; see {stderr.name}")
    records = []
    for line in events.read_text().splitlines():
        try:
            records.append(json.loads(line))
        except ValueError:
            raise RuntimeError("unexpected model event output")
    finished = [r for r in records if r.get("type") == "turn.completed"]
    if len(finished) != 1 or not report.is_file() or any(
            r.get("type") in {"turn.failed", "error"} or
            (r.get("model") and r["model"] != MODEL) for r in records):
        raise RuntimeError("could not verify a clean explicitly selected Luna turn")
    # The CLI does not always emit the serving model in streamed events.
    return {"model_requested": MODEL, "reported_model": next(
        (r["model"] for r in records if r.get("model")), None),
            "usage": finished[0].get("usage")}


def run_phase(repo, out, job, phase, overnight_end):
    before = g(repo, overnight_end, "rev-parse", "HEAD").strip()
    end = min(overnight_end, datetime.now(EAT) + timedelta(minutes=75 if phase == "feature" else 60))
    if remaining(end) <= STOP_LEEWAY + 60:
        return {"status": "skipped; not enough time before cutoff"}
    phase_rules = {
        "feature": "Implement only the approved feature below. Add focused deterministic tests.",
        "coverage": ("Review only the approved coverage scope below. Add one or more new focused "
                     "Vitest test files only. Do not change product code or existing tests; report "
                     "possible product bugs rather than fixing or hiding them."),
    }
    prompt = (
        "The IQTerminal owner explicitly approved this single overnight GPT-6 Luna exception to "
        "AGENTS.md's daytime Sol Max and shared Pi dev/no separate-checkout rules. Follow remaining "
        "repository engineering guidance. Work only in this isolated clone. No commit, push, other "
        "branches, deploy, signed/live/staging services, remote calls, credentials, model delegation "
        "or retries. Run only focused local checks. Do not edit lockfiles, config, scripts or "
        "dependencies. Do not open an app window. " + phase_rules[phase] + "\n"
        f"Approved scope: {job['prompt']}\nAllowed paths: {', '.join(job['allow'])}\n"
        "Report tests and remaining gaps. If no useful safe change is available, make no change.\n"
    )
    details = model(repo, out, phase, prompt, end)
    if g(repo, end, "rev-parse", "HEAD").strip() != before:
        raise RuntimeError("worker moved HEAD; discarded")
    paths = state(repo, end)
    if not paths:
        return {**details, "status": "no changes"}
    if not all(permitted(p, phase, job, repo, end) for p in paths):
        raise RuntimeError("out-of-scope files; discarded")
    approved_changes = fingerprint(repo, paths)
    checks = sorted(set(job["checks"]) | {p for p in paths if TEST_PATH.fullmatch(p)})
    if not checks or not all((repo / p).is_file() for p in checks):
        raise RuntimeError("no usable focused Vitest tests; discarded")
    with (out / f"{phase}.checks.log").open("wb") as log:
        command(["pnpm", "exec", "vitest", "run", "--", *checks], cwd=repo, until=end, log=log)
        if phase == "feature":
            command(["pnpm", "typecheck"], cwd=repo, until=end, log=log)
            command(["pnpm", "build"], cwd=repo, until=end, log=log)
    if (state(repo, end) != paths or fingerprint(repo, paths) != approved_changes
            or g(repo, end, "rev-parse", "HEAD").strip() != before):
        raise RuntimeError("verification altered checkout; discarded")
    g(repo, end, "add", "--", *paths)
    g(repo, end, "diff", "--cached", "--check")
    # Compare exact staged blobs too (e.g. a custom clean filter must not rewrite the diff).
    for path, (_, digest) in approved_changes.items():
        staged = g(repo, end, "show", f":{path}")
        if hashlib.sha256(staged).hexdigest() != digest:
            raise RuntimeError("staged contents differ from test-verified files; discarded")
    g(repo, end, "commit", "-m", f"Luna {phase}: {job['id']}",
      "-m", f"IQ-Luna-Job: {phase}/{job['id']}")
    commit = g(repo, end, "rev-parse", "HEAD").decode().strip()
    if state(repo, end):
        raise RuntimeError("checkout not clean after commit; discarded")
    return {**details, "status": "passed", "head": commit, "files": paths, "tests": checks}


def probe(repo, out, preflight_file, validate_publication=False):
    end = datetime.now(EAT) + timedelta(minutes=2)
    marker = "IQ_LUNA_PREFLIGHT"
    preflight_file.unlink(missing_ok=True)
    info = model(repo, out, "preflight", f"Reply exactly {marker}. Do not use tools.", end, True)
    if (out / "preflight.md").read_text().strip() != marker:
        raise RuntimeError("unexpected model preflight response")
    if validate_publication:
        ref = f"refs/heads/{BRANCH}"
        g(repo, end, "fetch", "--no-tags", REMOTE, ref)
        fetched = g(repo, end, "rev-parse", "FETCH_HEAD").decode().strip()
        g(repo, end, "push", "--dry-run", REMOTE, f"{fetched}:{ref}")
        info["publication_dry_run"] = True
    preflight_file.write_text(json.dumps(info) + "\n")
    return info


def write_summary(data, out, result, is_probe):
    def text(value):
        return str(value).replace("\n", " ")[:500]
    lines = [f"# IQTerminal Luna {'preflight' if is_probe else 'overnight report'}", "",
             f"- EAT: {result['started_eat']} to {result['finished_eat']}",
             f"- Model requested: {result['model']} ({result['effort']})",
             f"- Base: {result.get('base', 'not cloned')}",
             f"- Head: {result.get('head', 'unchanged')}",
             f"- GitHub luna-dev updated: {'yes' if result['published'] else 'no'}"]
    if "skip" in result:
        lines.append(f"- Skipped: {text(result['skip'])}")
    if "error" in result:
        lines.append(f"- Runner error: {text(result['error'])}")
    for phase in ("preflight",) if is_probe else ("feature", "coverage"):
        detail = result.get(phase)
        if not detail:
            continue
        lines.extend(["", f"## {phase.title()}",
                      f"- Result: {text(detail.get('status', 'passed'))}"])
        if "job" in detail:
            lines.append(f"- Approved job: {detail['job']}")
        if "error" in detail:
            lines.append(f"- Error: {text(detail['error'])}")
        if detail.get("files"):
            lines.append(f"- Files: {', '.join(detail['files'])}")
        if detail.get("tests"):
            lines.append(f"- Focused Vitest passed: {', '.join(detail['tests'])}")
        if phase == "feature" and detail.get("status") == "passed":
            lines.append("- Typecheck and production build passed.")
        if "usage" in detail:
            lines.append(f"- Usage: {detail['usage'] or 'not exposed'}")
        if "reported_model" in detail:
            lines.append(f"- Model reported by CLI: {detail['reported_model'] or 'not exposed'}")
        if (out / f"{phase}.md").is_file():
            lines.append(f"- Worker notes: {(out / f'{phase}.md').name} in this run’s local folder.")
    completed = "\n".join(lines) + "\n"
    (out / "report.md").write_text(completed)
    named = "latest-preflight.md" if is_probe else "latest-report.md"
    temporary = data / (named + ".new")
    temporary.write_text(completed)
    temporary.replace(data / named)


def main():
    flags = argparse.ArgumentParser()
    flags.add_argument("--state", required=True, type=Path,
                       help="private state on the isolated runner, outside source checkout")
    flags.add_argument("--queue", type=Path, help="private owner-approved JSON queue")
    flags.add_argument("--probe", action="store_true", help="one tiny authenticated Luna turn, no repo changes")
    flags.add_argument("--publish", action="store_true", help="publish passing commits to remote luna-dev")
    args = flags.parse_args()
    os.umask(0o077)
    data = args.state.expanduser().resolve()
    data.mkdir(parents=True, exist_ok=True)
    with (data / "worker.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Skipped: a Luna worker is already running.")
            return
        now = datetime.now(EAT)
        out = data / "runs" / now.strftime("%Y%m%dT%H%M%S%f%z")
        out.mkdir(parents=True)
        result = {"started_eat": now.isoformat(), "model": MODEL, "effort": EFFORT,
                  "feature": {"status": "not run"}, "coverage": {"status": "not run"},
                  "published": False}
        preflight_file = data / "preflight.json"
        try:
            if args.probe:
                g(out, now + timedelta(minutes=2), "init", "-q")
                result["preflight"] = probe(out, out, preflight_file, args.publish)
                return
            ending = cutoff(now)
            if ending is None:
                result["skip"] = "outside 20:00–05:00 EAT"
                return
            if not args.queue:
                raise ValueError("a private approved queue is required")
            approved = jobs(json.loads(args.queue.expanduser().read_text()))
            if not any(approved.values()):
                result["skip"] = "no approved work; no model called"
                return
            preflight = json.loads(preflight_file.read_text()) if preflight_file.exists() else {}
            if preflight.get("model_requested") != MODEL:
                raise RuntimeError("no successful Luna preflight on this runner")
            if args.publish and not preflight.get("publication_dry_run"):
                raise RuntimeError("no successful luna-dev publication dry run on this runner")
            with tempfile.TemporaryDirectory(prefix="iq-luna-", dir=data) as directory:
                tmp = Path(directory)
                repo = tmp / "repo"
                g(tmp, ending, "clone", "--branch", BRANCH, "--single-branch", "--no-tags", REMOTE, str(repo))
                original = g(repo, ending, "rev-parse", "HEAD").decode().strip()
                result["base"] = original
                # The model sees no configured remote, and the runner handles publication.
                g(repo, ending, "remote", "remove", "origin")
                history = set(g(repo, ending, "log", "--format=%B").decode().splitlines())
                attempts = data / "attempts"
                attempts.mkdir(exist_ok=True)
                pending = {phase: next((j for j in approved[phase]
                                        if f"IQ-Luna-Job: {phase}/{j['id']}" not in history
                                        and not (attempts / f"{phase}-{j['id']}").exists()), None)
                           for phase in ("feature", "coverage")}
                if not any(pending.values()):
                    result["skip"] = "all approved jobs already attempted or published; no model called"
                    return
                setup_end = min(ending, datetime.now(EAT) + timedelta(minutes=10))
                with (out / "install.log").open("wb") as log:
                    command(["pnpm", "install", "--frozen-lockfile", "--store-dir", str(data / "pnpm-store")],
                            cwd=repo, until=setup_end, log=log)
                clean_head = original
                for phase in ("feature", "coverage"):
                    job = pending[phase]
                    if not job:
                        result[phase] = {"status": "no pending approved job"}
                        continue
                    try:
                        (attempts / f"{phase}-{job['id']}").touch(exist_ok=False)
                        result[phase] = {"job": job["id"], **run_phase(repo, out, job, phase, ending)}
                        clean_head = result[phase].get("head", clean_head)
                    except (RuntimeError, subprocess.TimeoutExpired, TimeoutError, OSError) as error:
                        result[phase] = {"job": job["id"], "status": "blocked; not published",
                                         "error": str(error)}
                        events = out / f"{phase}.events.jsonl"
                        if events.is_file():
                            for line in events.read_text(errors="replace").splitlines():
                                try:
                                    record = json.loads(line)
                                except ValueError:
                                    continue
                                if isinstance(record, dict) and record.get("type") == "turn.completed":
                                    result[phase]["usage"] = record.get("usage")
                        # Never automatically retry a failed stage or build on its unverified tree.
                        break
                result["head"] = clean_head
                if clean_head != original:
                    diff = g(repo, ending, "diff", "--binary", original, clean_head)
                    (out / "verified.patch").write_bytes(diff)
                    if args.publish:
                        if g(repo, ending, "status", "--porcelain=v1", "-z", "--untracked-files=all"):
                            # Only publish a verified, clean commit via the wrapper.
                            g(repo, ending, "reset", "--hard", clean_head)
                            g(repo, ending, "clean", "-fd")
                        if g(repo, ending, "rev-parse", "HEAD").decode().strip() != clean_head or state(repo, ending):
                            raise RuntimeError("publication checkout is not the verified clean commit")
                        # No force. Check that the remote has not moved, and let Git enforce fast-forward.
                        ref = f"refs/heads/{BRANCH}"
                        remote_base = g(repo, ending, "ls-remote", "--exit-code", REMOTE, ref).decode().split()
                        if remote_base != [original, ref]:
                            raise RuntimeError("remote luna-dev changed; review instead of overwriting")
                        g(repo, ending, "push", REMOTE, f"{clean_head}:{ref}")
                        remote_head = g(repo, ending, "ls-remote", "--exit-code", REMOTE, ref).decode().split()
                        if remote_head != [clean_head, ref]:
                            raise RuntimeError("push attempted but final GitHub head could not be verified")
                        result["published"] = True
        except (RuntimeError, subprocess.TimeoutExpired, TimeoutError, OSError, ValueError) as error:
            result["error"] = str(error)
            raise SystemExit(1) from error
        finally:
            result["finished_eat"] = datetime.now(EAT).isoformat()
            raw = json.dumps(result, indent=2)
            (out / "run.json").write_text(raw + "\n")
            write_summary(data, out, result, args.probe)
            print(raw, flush=True)


if __name__ == "__main__":
    # Use the same cleanup path on systemd stop; KeyboardInterrupt propagates through subprocess groups.
    signal.signal(signal.SIGTERM, lambda *_: signal.raise_signal(signal.SIGINT))
    main()

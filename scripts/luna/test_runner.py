import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta

import runner


class RunnerTest(unittest.TestCase):
    def test_window(self):
        for hour, minute, expected in [(19, 59, None), (20, 0, 20), (23, 59, 20),
                                       (0, 0, 19), (4, 59, 19), (5, 0, None)]:
            with self.subTest(hour=hour, minute=minute):
                end = runner.cutoff(datetime(2026, 11, 19, hour, minute, tzinfo=runner.EAT))
                self.assertEqual(end.day if end else None, expected)
                if end:
                    self.assertEqual(end.hour, 5)

    def test_timeout_terminates_child_group(self):
        with TemporaryDirectory() as folder:
            path = Path(folder)
            with patch.object(runner, "STOP_LEEWAY", 0):
                with self.assertRaises(subprocess.TimeoutExpired):
                    runner.command(["sh", "-c", "(sleep .5; touch escaped) & wait"],
                                   cwd=path, until=datetime.now(runner.EAT) + timedelta(seconds=.15))
            import time
            time.sleep(.6)
            self.assertFalse((path / "escaped").exists())

    def test_exact_model_no_fallback(self):
        cmd = runner.model_command(Path("/repo"), Path("/report"))
        self.assertEqual(cmd[cmd.index("-m") + 1], "gpt-6-luna")
        self.assertEqual(cmd.count("-m"), 1)
        self.assertIn('model_reasoning_effort="medium"', cmd)
        self.assertIn('model_provider="openai"', cmd)
        self.assertIn("--ephemeral", cmd)
        self.assertEqual(cmd[cmd.index("-a") + 1], "never")

    def test_empty_queue_does_not_require_clone_or_model(self):
        with TemporaryDirectory() as tmp:
            dest = Path(tmp)
            (dest / "queue.json").write_text('{"feature":[],"coverage":[]}')
            now = datetime(2026, 11, 19, 20, 0, tzinfo=runner.EAT)
            with patch.object(runner, "datetime", wraps=datetime) as clock, \
                 patch.object(runner, "g", side_effect=AssertionError("git called")), \
                 patch.object(runner, "model", side_effect=AssertionError("model called")), \
                 patch("sys.argv", ["runner.py", "--state", tmp, "--queue", str(dest / "queue.json")]):
                clock.now.return_value = now
                runner.main()
            report = json.loads(next((dest / "runs").glob("*/run.json")).read_text())
            self.assertEqual(report["skip"], "no approved work; no model called")
            self.assertFalse(report["published"])
            latest = (dest / "latest-report.md").read_text()
            self.assertIn("no approved work; no model called", latest)
            self.assertIn("GitHub luna-dev updated: no", latest)

    def test_no_unsafe_changes(self):
        repo = Path("/not-used")
        job = {"allow": ["src/*", "tests/*"]}
        for file in ["package.json", ".github/workflows/scheduled.yml",
                     "scripts/luna/runner.py", "src/trade/signed.ts",
                     "src/views/signing-control.ts", "tests/browser/overlay.test.ts",
                     "src/.hidden.ts", "src/../package.json"]:
            with self.subTest(file=file):
                if runner.safe_path(file):
                    self.assertFalse(runner.permitted(file, "feature", job, repo, None))
        self.assertFalse(runner.permitted("src/indicator.ts", "coverage", job, repo, None))
        with patch.object(runner, "g", return_value=b"tests/existing.test.ts\n"):
            self.assertFalse(runner.permitted("tests/existing.test.ts", "coverage", job, repo, None))
        with patch.object(runner, "g", return_value=b""):
            self.assertTrue(runner.permitted("tests/new.test.ts", "coverage", job, repo, None))

    def test_test_side_effect_same_path_never_commits(self):
        with TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            repo = root / "repo"
            repo.mkdir()
            (repo / "tests").mkdir()
            out = root / "out"
            out.mkdir()
            end = datetime.now(runner.EAT) + timedelta(minutes=2)
            runner.g(repo, end, "init", "-q")
            runner.g(repo, end, "config", "user.email", "test@example.invalid")
            runner.g(repo, end, "config", "user.name", "Fixture")
            runner.g(repo, end, "commit", "--allow-empty", "-qm", "Initial")
            initial = runner.g(repo, end, "rev-parse", "HEAD")
            test_path = repo / "tests/new.test.ts"
            job = {"id": "fixture", "prompt": "One fixture case", "allow": ["tests/new.test.ts"], "checks": []}

            def fake_model(*args, **kwargs):
                test_path.write_text("approved test content")
                return {"usage": None}

            original_command = runner.command

            def fake_process(argv, **kwargs):
                if argv[0] == "pnpm":
                    test_path.write_text("changed by command without touching other paths")
                else:
                    return original_command(argv, **kwargs)

            with patch.object(runner, "model", side_effect=fake_model), \
                 patch.object(runner, "command", side_effect=fake_process):
                with self.assertRaisesRegex(RuntimeError, "verification altered checkout"):
                    runner.run_phase(repo, out, job, "coverage", end)
            self.assertEqual(runner.g(repo, end, "rev-parse", "HEAD"), initial)

    def test_local_simulation_publishes_only_verified_luna_and_never_retries(self):
        import os
        with TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            upstream, repo, dest = [root / name for name in ("upstream", "seed", "state")]
            for path in (upstream, repo, dest):
                path.mkdir()
            end = datetime.now(runner.EAT) + timedelta(minutes=2)
            runner.g(upstream, end, "init", "--bare", "-q")
            runner.g(repo, end, "init", "-q", "-b", "main")
            env = {"GIT_AUTHOR_NAME": "Fixture", "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
                   "GIT_COMMITTER_NAME": "Fixture", "GIT_COMMITTER_EMAIL": "fixture@example.invalid"}
            with patch.dict(os.environ, env):
                runner.g(repo, end, "commit", "--allow-empty", "-qm", "Initial")
                initial = runner.g(repo, end, "rev-parse", "HEAD")
                runner.g(repo, end, "push", str(upstream), "HEAD:refs/heads/main", "HEAD:refs/heads/luna-dev")
                queue = dest / "queue.json"
                job = {"id": "fixture", "prompt": "Add one regression test.",
                       "allow": ["tests/regression.test.ts"], "checks": []}
                queue.write_text(json.dumps({"coverage": [job]}))
                (dest / "preflight.json").write_text(json.dumps(
                    {"model_requested": runner.MODEL, "publication_dry_run": True}))
                now = datetime(2026, 11, 19, 20, 0, tzinfo=runner.EAT)

                def fake_model(clone, *args, **kwargs):
                    (clone / "tests").mkdir()
                    (clone / "tests/regression.test.ts").write_text("fixture content\n")
                    return {"usage": {"input_tokens": 123}}

                original_command = runner.command

                def fake_process(argv, **kwargs):
                    if argv[0] == "pnpm":
                        return b""
                    return original_command(argv, **kwargs)

                with patch.object(runner, "datetime", wraps=datetime) as clock, \
                     patch.object(runner, "REMOTE", str(upstream)), \
                     patch.object(runner, "model", side_effect=fake_model) as launched, \
                     patch.object(runner, "command", side_effect=fake_process), \
                     patch("sys.argv", ["runner.py", "--state", str(dest), "--queue", str(queue), "--publish"]):
                    clock.now.return_value = now
                    runner.main()
                    head = runner.g(upstream, now + timedelta(minutes=2), "rev-parse", "refs/heads/luna-dev")
                    self.assertNotEqual(head, initial)
                    self.assertEqual(runner.g(upstream, now + timedelta(minutes=2), "rev-parse",
                                              "refs/heads/main"), initial)
                    self.assertIn("GitHub luna-dev updated: yes", (dest / "latest-report.md").read_text())
                    clock.now.return_value = now + timedelta(days=1)
                    runner.main()
                    self.assertEqual(launched.call_count, 1)

    def test_api_key_login_never_calls_inference(self):
        with TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            end = datetime.now(runner.EAT) + timedelta(minutes=2)
            def fake_command(argv, **kwargs):
                self.assertEqual(argv, ["codex", "login", "status"])
                self.assertNotIn("OPENAI_API_KEY", kwargs["env"])
                kwargs["log"].write(b"Logged in using an API key")
            with patch.object(runner, "command", side_effect=fake_command), \
                 patch.object(runner.subprocess, "Popen", side_effect=AssertionError("model called")):
                with self.assertRaisesRegex(RuntimeError, "refusing to use an API key"):
                    runner.model(root, root, "feature", "test", end)


if __name__ == "__main__":
    unittest.main()

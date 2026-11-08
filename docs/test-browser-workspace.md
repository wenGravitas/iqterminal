# Test browsers on i3 workspace9

Headed IQTerminal tests use `--class=IQTerminalPerf`. The loaded i3 configuration
must include these rules before a browser is launched:

```i3
assign [class="^IQTerminalPerf$"] 9
no_focus [class="^IQTerminalPerf$"]
```

The Playwright global setup reads the running i3 configuration and refuses a
headed launch if either rule or the browser class is missing. It does not reload
i3, switch workspaces, or move ordinary Chromium windows. Headless tests and
non-i3 sessions bypass this host-specific check.

Standalone Pi probes also call `scripts/test-browser-workspace.mjs` before
navigation, checking actual test-window placement and refusing to navigate if
workspace9 cannot be verified. This is an additional placement check, not a
substitute for the pre-map i3 rules. Keep both when adding a headed probe.

Three consecutive fresh Chromium contexts, including explicit Playwright
`bringToFront()` requests, were observed on workspace9 while workspace1 remained
focused. This check did not reproduce the reported intermittent escape; retain
placement monitoring rather than treating that observation as proof it cannot
recur. Browser placement/focus checks do not certify chart performance.

Standalone Pi probes now use `test-browser-launch.mjs`, which checks the loaded
class and temporary-profile instance assignment/no-focus rules **before** calling
Chromium. The old post-launch placement check remains an additional check.
The guard also detects i3 when a child runner omits `I3SOCK`.

A fresh three-browser check kept all 30 placement samples on workspace9 and
left workspace3 focused, including activation requests. Chromium on this Pi
ignores `--name` for its X11 instance, so routing uses the observed Playwright
profile instance plus the dedicated class. This check did not reproduce the
reported escape; it does not establish that every other launcher is guarded.

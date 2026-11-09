# Visible wall preparation tasks

Wall geometry/reference/native-path preparation already had a6mssoft work
budget, cancellation and a final actual-paint fence. Its continuation still
used nested `setTimeout(0)` calls. Browser minimum timer delays accumulate
between hundreds of mandatory visible-work slices even when CPU is available.

The renderer now uses the existing history task helper at user-visible priority,
with one independently abortable pending task per chart. Supported browsers use
`scheduler.postTask`; other platforms retain the timer fallback. The helper can
run a supplied callback in that task, preserving error/completion behavior on
both paths. Existing yield-only callers keep their behavior and priorities.
The6mswork budget, geometry, style, point retention and publication rules stay
unchanged. This is neither a larger CPU slice nor user-blocking priority.

The queued owner is checked before every callback. Transform/settings changes
and detach abort obsolete work, including callbacks that arrive after disposal.
Hidden charts pause without a task loop and resume through their next draw.
Preparation requests a frame when the prepared cache is ready; it never marks
the latest revision painted until the chart actually draws it. The previous
completed cache remains available while a new pass is pending.

Diagnostics expose `preparation.yieldMode` and the actual pending-task flag.
The legacy `backgroundMs` fields describe elapsed scheduled work outside RAF,
not background task priority. They overlap `activeMs`; do not sum them as
exclusive phases or interpret either as pure CPU time. The soft budget cannot
interrupt native path operations, GC or OS scheduling.

Focused regressions prove native visible-task admission, timer fallback,
in-task callback execution, callback failure/completion behavior, canceled task
ownership, exact finished geometry/styles and waiting for an actual paint.
The initial native-task fixture accidentally faked the work clock; its failed
attempt is retained. Corrected fixtures preserve the deterministic clock and
reject the predecessor's scheduling/callback behavior before passing the fix.
Production browser measurements must establish actual mode and loading/current
effects; passing these fixtures does not certify a latency or foreground gate.

Rollback is this scheduling/helper change. It does not affect the independent
per-segment projection optimization, prepared wire/core identity, source data,
collector processes, live sockets or cursors. No cache rebuild is needed.

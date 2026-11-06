# Empty temporary wall-batch response recovery

This is functional correctness evidence, not retained-source or loading acceptance.
Full suite: 1093 pass, two skipped, repeated before/after native fetch binding fix.
Final scoped checks: 15 pass; earlier scheduler/archive/lifecycle cohort: 96 pass.
Typecheck/build pass. Earlier failed metrics test used a nonexistent reference
restore method; the final test uses an independently populated canonical projector.
The first browser probe exposed accidental method binding of native window.fetch;
the final reader calls the injected fetch function directly. Both logs retained.

Reproduce the offline browser protocol check from frontend root:

```sh
/home/daz/workarea/iqterminal-server-perf-history/node_modules/.bin/esbuild src/feed/prepared-wall-batch.ts --bundle --platform=browser --format=iife --global-name=WallBatchRetry --outfile=/tmp/iq-wall-batch-retry-browser.js
IQ_RETRY_FIXTURE_PROBE=1 IQ_RETRY_BUNDLE=/tmp/iq-wall-batch-retry-browser.js node scripts/pi-wall-batch-retry-probe.mjs
```

The script explicitly intercepts a local blank page and batch request. It injects
one HTTP 408 and then a correctly framed/hashed decimal record. It verifies two
requests/attempts and exact content. System Chromium is headed on workspace 9.
No exchange/source data or live connection is used by this probe. The captured
bundle SHA identifies the executed retry implementation. Real-route gate failures
remain in the preceding wall-paint-cache evidence and are not superseded here.

# Client prepared wall admission lifecycle

Client implementation 9febaff3c2f3fd4a38e7f09a0c83787ad2d404b0, followed by
revision-command repair 997e38357f8d4218bc5f0773514542854fb7bf7e.
Backend protocol implementation 00f11e0b0cbf92e496602bff1f993ce90c033981 remains
disabled on serving staging. No production deployment, merge or collector action.

The client waits for prepared work using a consumer identity and exact job hint,
yielding its history slot during delays. Build progress/source coverage never
claims received/painted history. Last interest is released independently of peers.
Failure category/retryability reaches the view; explicit Retry is stable across
renewals. A source-change found while resuming an old prefix escalates once to a
distinct revision command, retaining displayed bars until validation completes.

Final results: 75 focused and 1,104 full tests pass / two full skips; typecheck and
production staging diagnostics build pass. Four flow tests fail on 728cc51 (old
client falls back to serial legacy paging / loses build failure semantics). The
revision test fails on 9febaff (the worker correctly ignores an acknowledged token
whose intent was changed). Both baseline outputs are retained. The old baseline
test title mentions reconnect; these fixtures have no current group and do not
prove healthy-live continuity. Their assertion also prevents accidental current
subscriptions. The final portable canonical projector still matches the backend
byte-for-byte at c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c.

The normal headed Chromium 155.0.8059.79 check runs on i3 workspace 9 using the
actual helper bundled from 9febaff. It is an explicitly offline HTTP protocol
fixture: consumer A aborts after one discovery; consumer B progresses across three
discoveries; each sends its own release; two between-poll samples see no occupied
scheduler slot. Job/Retry headers are preserved. Browser JSON, exact bundle and
script/bundle hashes are retained. The later service revision repair is covered by
997e383 tests/build, not this helper-only probe.

No chart is rendered and no retained/live data is accessed by that browser probe.
It is not a Pi loading, current confirmation, cold materialization, warm revisit,
memory/frame plateau or real-chart coverage test. The shown cold progress is
metadata, not first useful historical content. All earlier failed/unproven gates
remain unchanged. Real isolated persistent worker/gateway/client validation,
serving rollout validation, rolling/default reuse, cold progressive-content
delivery and derived retention remain required.

Build metadata records actual compiled source/environment/assets; the original
source-before-repair build and 74-test output are retained separately. The latest
build is production Vite, mode staging, VITE_DATA_MODE=staging,
VITE_HISTORY_TILES=1 and VITE_DIAGNOSTICS=1. The previously measured real-route Pi
chart client is still 7a1f6b1; no new loading samples are inferred from this build.

Probe invocation: IQ_WALL_ADMISSION_FIXTURE_PROBE=1 node
scripts/pi-wall-admission-browser-probe.mjs. The required opt-in and workspace
guard precede navigation. Rollback uses the previous client build; producer
checkpoints, healthy current feeds and immutable server caches are not reset.

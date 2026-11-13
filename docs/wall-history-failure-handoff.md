# History failures through saved-view restore

Frontend `e12965d38f9dc584c8fdfe46b8817a249166259a` preserves a bounded server reason
for failed wall discovery/final source validation. Frontend
`f25c76e` fixes the independently reproduced late-consumer failure handoff and
Retry validation state. Overall performance acceptance remains **INCOMPLETE**;
these changes do not recertify the previously failed loading cohorts.

## Root cause and repair

The old discovery reader canceled non-success bodies immediately, so the chart
could report only HTTP503. The new reader accepts at most4096 bytes, waits at most
one second for a stalled error body, presents only a sanitized240 character JSON
`error` string, and otherwise falls back to the HTTP status. Consumer cancellation
remains cancellation. No new request or automatic retry is introduced, and no
healthy request waits for this error-only path.

A headless production-build fault injection then found a separate lifecycle bug.
The early saved-view holder received the failure before the real chart subscribed.
The shared job was settled but its failure existed only on the original
subscription, not on the job. Later restore/chart consumers joined that job and
received only the initial loading snapshot; no further request or completion
would arrive. The retained worker trace shows the error delivered to
`restore-1:walls:chart-bench`, followed by three later subscribers receiving only
initial loading status. This explains a permanent spinner despite the worker's
failure counter increasing.

The shared job now retains its small failure description and replays it to later
consumers after any good financial prefix. Joining does not restart the request,
clear displayed data, or change the financial projector. Retry clears the shared
failure and marks retained revision metadata pending; a late consumer cannot
mistake an old successful revision for newly validated coverage. A stopped
historical-only job now leaves the loading state; healthy live-current status
still takes priority independently. Resume/recovery clears the stale reason.

## Verification and scope

- 74 focused tests pass across bounded error receipt, admission, prepared history,
 lifecycle and warm reuse. The full suite passes 1304 tests with two skipped;
 typecheck and production build pass. The existing large-bundle warning remains.
- The old HTTP readers fail both new server-reason regressions. The old shared-job
 code fails all three late-consumer/old-revision regressions. Exact failure logs
 are retained; candidate sources were restored byte-for-byte after each check.
- The final headless UI check on production build `f25c76e` passes with an explicitly
 injected discovery503, real staging native candles, fixtures false and exact
 build verification. It displays the specific reason plus Resume history;
 native status is live and 1000 native bars remain. This is a fault-injection UI
 check, not a real source failure, ACK-continuity proof or wall latency gate.
- The first UI attempts include missing test tunnels and pre-fix handoff failures.
 All attempts are retained. Only absent owned 18880/18881 SSH forwards were restored
 after remote health and local listener verification. Production/collector/API
 containers were not restarted.

[Successful UI evidence](../artifacts/pi-history-r1/discovery-diagnosis-r2/error-ui.json),
[screenshot](../artifacts/pi-history-r1/discovery-diagnosis-r2/specific-history-error.png),
[pre-fix worker handoff trace](../artifacts/pi-history-r1/discovery-diagnosis-r2/ui-attempt6/result.json),
and [protected identities](../artifacts/pi-history-r1/discovery-diagnosis-r2/protected-check.json)
are included with executed scripts and test/build output. All eight protected
service IDs/start times are unchanged. The side gateway remains71f62d2 and its
isolated worker0811e74; no backend deployment, main merge or production change.

## Separate transport and discovery diagnosis

A local synthetic496022 byte transport control uses the incumbent production-
preview proxy, no browser or exchange data. All five direct/proxy pairs preserve
bytes and hashes. Direct total ms:76.75/7.67/5.55/9.44/10.50 (median9.44,max76.75).
Preview:31.49/34.03/20.80/23.21/16.42 (median23.21,max34.03). This does not reproduce
the multi-second route delay alone, and is not a financial or loading benchmark.
The raw TCP/Tailscale samples document the observed private route; no network,
kernel or collector configuration was changed.

Five later loopback discovery diagnostics per market all return ready with the
same pinned source tokens. Spot total ms:724.0/305.5/746.4/663.7/299.8;
median663.7,max746.4. USD-M885.9/1111.7/621.8/428.2/698.4;
median698.4,max1111.7. Metadata decoded bytes are154112and1154528respectively.
The bounded diagnostic now handles the latter within the product's existing8 MiB
metadata bound; the earlier512 KiB diagnostic failure remains recorded. These
loopback diagnostics do not resolve the earlier intermittent503 cause or prove
healthy-source behavior during concurrent chart loads.

Two additional pre-fix Pi browser diagnostics both remain incomplete at12s;
first useful history is5034.6ms/missing. They are supplemental two-run diagnostics,
not a five-run acceptance cohort. No real503 recurred in those two observations,
so its exact server category remains unresolved. Full raw records accompany the
original failed five-run cohorts rather than replacing them.

## Operations, retry and rollback

Use Resume history/Retry on the failed historical view. Its good prefix remains
visible; ordinary polling does not restart the failed job, and unrelated healthy
feed sockets/cursors remain intact. A late chart consumer receives that same
failure until explicit Retry or a new view. Success must validate coverage before
clearing pending revision status. Malformed, oversized or stalled error bodies
retain the concise HTTP-status fallback.

The frontend commits can be reverted without touching canonical data, collectors,
derived state or server queues. Existing backend protocol2 rollback restrictions
remain in [isolated serving operations](wall-isolated-serving-results.md). The
original client/server routes remain available; the new previews are isolated
loopback test processes. Headed tests remain disabled to protect the working i3
workspace.

Current/wall loading, concurrent live responsiveness, heap plateau, normal
foreground Pi UX and default prepared-prefix/current-tail composition still need
acceptance. Default rolling closed windows are prepared; arbitrary live viewport
endpoints do not yet have proven automatic closed-prefix/tail composition. No
missing interval is labeled complete and no timing threshold is widened here.

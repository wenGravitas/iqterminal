# Goal acceptance evidence

This maps the requested outcome to inspected implementation and recorded evidence.
Performance targets are measured separately from functional correctness; a target
miss is not concealed by reducing detail or calling a partial view complete.

| Requirement | Implementation / evidence |
| --- | --- |
| Establish real baseline and bottleneck | `baseline-fixed-aligned.json`, `baseline-current.json`; request traces and local stage timings in the generated performance summaries. Baseline misses left-edge columns and overfetches footprints. |
| Visible-first, fair shared work | `history-scheduler.ts`, `staging-service.ts`, `staging-heatmap.ts`; scheduler cancellation/refcount tests and two-panel browser trials. No 300-bar startup fetch. |
| Durable incremental closed history | Backend `history-core/reader/materializer/store/publication.ts`; migration004, persisted jobs/checkpoints/publication journal, supervised materializer. |
| Exact measurement and coverage | Backend differential/core/store tests; eight real reference comparisons, restart proof, canonical SQL overlap/correction proof. Direct simultaneous coarse-price accumulation and duration integrals. |
| Versioned serving and client caching | Manifest/current/tiles/footprints API; content revisions; sparse 64-row blocks; async bounded IndexedDB and edge masks. Cache/revision/generation tests and warm browser trials. |
| Supported configurations and fallback | Six prepared5m widths; exact persisted on-demand accumulation for other supported widths/timeframes. Explicit client legacy flag; separate raw-replay counters. |
| Broad recorded depth | Wide two-panel browser evidence, `coverage-check.json`, partial-row hatching/effective resolution footer. Existing 200k collector limit unchanged. |
| Reliable collection and recovery | Independent Compose collector/API/materializer; actual materializer restart leaves collector ID unchanged.480-sample resource monitor, no overflow, bounded backlog. |
| Correction, duplicate and failure safety | Canonical FINAL executions, idempotent content hashing, publication journal failure/restart test, revision invalidation tests; explicit correction procedure. |
| Private access and budgets | Inspected loopback listeners18780/18782/18784 and existing DB ports; existing SSH route; source32GiB + derived8GiB guards, free-space20GiB floor, seven-day derived TTL. |
| Five comparable A/B/C/D/E loads | October 13 `release-*` series, each n=5. October 16 `verified-*` repeats A/B/D/E after final guards. C cannot safely be rebuilt after raw retention expiry; retained five-trial evidence is explicit. |
| Live/history merging | Separate live footprint accumulator; prepared closed presentation replacements with tile revision; forming-only heatmap updates. Overlap/reconnect/rollover tests and current browser holds. |
| Deployment and rollback | Additive migration reapplied, independent services healthy; routine rollout waits for readiness and checks collector identity. Legacy client switch and saved previous image/layout documented. |
| Deliverables and provenance | Client/backend focused commits, scripts, raw JSON evidence, report, architecture/operations docs and checkpoints. No push by this goal; unrelated backend changes preserved. |

The cold under-five-second target remains missed. Warm first display is measured
separately from authoritative completion. Browser delays and server-only timings
are not interchangeable. See `history-performance.md` for sample counts, actual
medians/maxima, resource limits and the later host/route conditions.

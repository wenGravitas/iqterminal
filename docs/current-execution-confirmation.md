# Current execution confirmation during history loads

The durable execution server holds one pending cursor until it receives the
matching ACK (`src/server.ts` pump/ACK handler). A subsequent validated batch
starting at that ACK cursor therefore confirms the prior ACK chain. A live
badge, healthy HTTP response or increasing chart timestamp alone does not.

Each footprint group now retains constant-size proof counters: validated/applied
batches and executions, ACKs sent, prior ACKs confirmed by the next same-socket
batch, source cursor jumps, socket starts/closes, resets/errors and worker-local
apply/receipt durations. New sockets clear pending-ACK confirmation. Ignored old
socket messages and prepared history do not advance proof. Invalid batches fail
before application and successful proof; source jumps retain incumbent gap
marking. Last ACK is deliberately unconfirmed until another batch follows.
No executions or financial cells are retained by the counters. They share group
lifetime and disappear on final unsubscribe.

The opt-in concurrency harness waits for an independently confirmed live chain,
captures fresh worker diagnostics before/after its observation, and compares five
alternating current-only and two-footprint-history scenarios. An explicit pinned
window file allows retained source to be verified without overwriting the frozen
wall benchmark window. Full4h5m/24h1h ranges, saved views and cancel/restore work
remain required. Any missing slot prevents coverage acceptance.

`current-execution-proof.mjs` rejects absent/stagnant/regressed counters, invalid
ACK relationships, reconnect/reset/error, disconnected/non-live observations and
new explicit source cursor jumps. A source jump requires attribution; it is not
automatically a client performance failure. The chain subgate is separate from
responsiveness, chart paint, cold custom backfill, all source health and normal
foreground UX. Worker lifetime receipt maxima may include pre-observation time;
callback receive gaps use the bounded observation clock. No unsynchronized
client/server timestamps are subtracted.

Focused staging regressions verify advancing confirmation, detached diagnostic
snapshots, ignored old sockets, reconnect boundaries, invalid frames, resets and
explicit source jumps. The proof gate has counterfactual tests against a live
badge without actual progress. Financial paths, admission limits, ACK protocol,
exchange connections, historical/current separation and retry behavior stay
unchanged.

Rollback: revert the counters/diagnostic field and rebuild the client. Counters
are observational; no backend deployment, collector restart, cursor reset or
prepared-data migration is required. Results are reported separately from this
contract and must not be inferred from its tests.

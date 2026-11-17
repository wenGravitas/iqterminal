# Staging proxy capacity, cancellation and timing

The private proxy reserves two native-candle history sockets and two bulk-history
sockets (four historical HTTP sockets total), by default on SSH18780. Four
independent current/control/health sockets use SSH18781. Agent `maxTotalSockets`
also bounds each pool across optional upstream origins, not only per host.
WebSocket routes retain their streaming agent configuration. The backend still
has its own bounded admission; these local sockets do not grant extra DB slots.

`node --test scripts/staging-proxy-capacity.test.mjs` runs five cycles through
each actual Vite development and production-preview HTTP proxy with isolated
loopback fixture upstreams. Two bulk requests occupy two separate upstream
origins and a third bulk request must queue. Two reserved native requests must
still reach upstream, another native request is cancelled while queued, a
surviving native request waits, and independent current health completes.
Cancelling one open history request reaches the upstream and frees its slot for
the surviving queued request. Every remaining held request is then cancelled
and observed closed upstream. No browser or exchange connection is opened.

Current multi-origin samples are retained with the native-history lane evidence
under `artifacts/pi-history-r1/native-history-lane-paired/`. The earlier shared
four-slot baseline remains in `artifacts/pi-history-r1/proxy-capacity-r1/samples.json`.
Both retain every sample and response header. This is request-path fixture evidence, not
prepared-history latency, real current freshness or exchange coverage acceptance.

`X-IQ-Proxy-Queue-Ms` measures local arrival-to-upstream-socket assignment.
`X-IQ-Proxy-Header-Ms` measures socket-assignment-to-upstream-headers, including
connection/SSH/remote work. Both use the same proxy monotonic clock and are
nested inside the client's header wait. They must not be added to that wait,
nor subtracted from an unsynchronised server clock. Existing gateway request ID,
view ID and Server-Timing fields pass through. New `proxyqueue`/`proxyheader`
Server-Timing fields append to the backend fields. Worker history traces retain
the two durations separately. Weak request keys retain no historical bodies.

The installed Vite proxy already destroys upstream requests when an unfinished
downstream closes; wire tests cover both queued and assigned sockets. No second
cancellation implementation is installed. If that dependency behaviour changes,
the wire check must fail rather than silently retaining obsolete viewport work.

Rollback is the frontend commit revert; no private ports, collector, source
retention, backend serving or production configuration changes are required.

An optional `VITE_NATIVE_HISTORY_API_URL=http://127.0.0.1:18795` setting at preview
startup can use an independently established SSH forward to staging18780 for
native candle reads. Only loopback HTTP targets are accepted. It creates no
exchange connection; it is an experiment with a third SSH TCP transport. The
five-pair Spot30h experiment did not improve median latency, so the default
tunnel script still starts only18780/18781. Do not present this option as a
performance fix or an acceptance pass. Unset it and restart the owned preview
to return to the default route; verify command identity before closing an
experimental tunnel, and leave the incumbent two tunnels running.

Dev and preview shutdown both destroy their owned proxy agents. Retry a failed
chart history view through its existing scoped Retry control; a proxy setting
change is not a reason to reconnect unrelated healthy live feeds.

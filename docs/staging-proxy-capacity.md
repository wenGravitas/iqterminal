# Staging proxy capacity, cancellation and timing

The established private split stays unchanged: four history agent sockets on
SSH18780 and four independent current/control/health sockets on SSH18781.
WebSocket routes retain their streaming agent configuration. The backend still
has its own bounded admission; these local sockets do not grant extra DB slots.

`node --test scripts/staging-proxy-capacity.test.mjs` runs five cycles through
each actual Vite development and production-preview HTTP proxy with isolated
loopback fixture upstreams. Four historical requests remain open; a fifth is
cancelled while queued, a sixth waits, and a current health request completes.
Cancelling one open history request reaches the upstream and frees its slot for
the surviving queued request. Every remaining held request is then cancelled
and observed closed upstream. No browser or exchange connection is opened.

Raw samples in `artifacts/pi-history-r1/proxy-capacity-r1/samples.json` retain
every sample and response header. This is request-path fixture evidence, not
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

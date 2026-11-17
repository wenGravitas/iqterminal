# Keep Level Watch control off historical transport

Client4efc Spot run5 records a2859-byte Level Watch response taking7992ms, while
server legacy work is3.73ms. Its proxy admission/socket wait is2508ms and header
wait5443ms. The first wall batch simultaneously waits3994ms in proxy admission/
socket allocation. These overlapping/nested waits must not be added as exclusive
phases or treated as database execution time.

Level Watch reads and its acknowledged event stream previously used the broad
historical fallback. They now use the existing private current route on18781:
HTTP uses the bounded currentBookAgent and current admission reserve; WebSocket
uses the same explicit streaming bypass as the other live routes. Targets still
reach the same private gateway, with the same path rewrite and existing backend
authentication/origin handling. No socket/admission limit, exchange connection,
collector, raw retention or server code changes.

The local wire regression holds two bulk and one native response open. Old
routing cannot serve the watch GET; candidate routing serves it, health and the
watch WebSocket upgrade while all three history responses stay held. It uses
only ephemeral loopback fixtures and makes no real watch action. Four routing/
budget tests and typecheck pass. The initial Socket/Duplex fixture typing error
is retained separately. This does not certify real watch events or Pi latency.

Apply by rebuilding the client and restarting only the owned staging preview to
load the Vite proxy configuration. Preserve the existing SSH forwards and server
services. Verify actual request routes, configuration/build and real chart gates.
Rollback is a proxy-config/client revert and preview restart; do not reset source
files, collector state or acknowledged cursors. This operator restart is separate
from History Retry, which continues preserving healthy transports.

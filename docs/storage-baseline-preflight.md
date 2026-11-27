# Storage benchmark admission and local client readiness

The local client and separate staging transports were started from the shared
`dev` checkout using the existing `pnpm dev:staging --strictPort` and
`pnpm tunnel:staging` commands, supervised by user transient services. They bind
only loopback. The page, proxied current health and history health returned HTTP
200. The transformed worker reports staging mode, prepared history enabled and
client build `8a633856fe758ddaedf2e35406bbbb951ad19aac`. These are transport and
served-checkout checks, not proof that charts rendered or updated.

The storage candidate remains unselected on staging. No backend deployment,
retention change, materialization request, source deletion or paid provisioning
was performed by this preflight.

## Actual source admission

`scripts/storage-baseline-preflight.mjs` reads only the existing horizon/source
metadata endpoints. It reuses the benchmark's frozen native profile IDs and
48-hour native request bound. For each market it chooses a closed end one hour
behind the earlier of controller time and source head, then plans 1/7/30-day
ranges. It makes only one source-eligibility read for the requested day's
intersection with the available horizon. Longer-window chunks are plans, not
executed source or materialization requests.

The [actual report](storage-baseline-evidence/admission.json) made four metadata
GETs through `http://127.0.0.1:5173/`, with no retries or preparation. Both selected
day windows end at **2026-11-27 14:41 UTC**:

| Market | Horizon begins UTC | Selected day source eligibility | Selected day source records | Seven-day horizon | Thirty-day horizon |
|---|---|---|---:|---|---|
| Spot | 2026-11-01 08:26:05.645 | eligible | 21,333 | within horizon; 4 native chunks | partial; retained intersection needs 14 chunks |
| Perpetual | 2026-11-01 04:16:44.584 | eligible | 34,502 | within horizon; 4 native chunks | partial; retained intersection needs 14 chunks |

A horizon provides first/last availability, not continuous coverage. Seven-day
continuity and full source eligibility were not checked. Thirty-day missing
prefixes remain explicit. The counts above are native wall-source records for
the selected profile, not rendered segments/runs, raw-depth ingestion rates or
compressed storage growth. Source tokens bind this observation; they are not
financial acceptance or a replacement for source/coverage validation at use time.

Do not update only tokens in existing `pi-wall-reference.json`. Exact reference
counts, source, original coverage and projection hashes still need to be
recalibrated together before the existing rendering harness can use a new window.

## Reproduce without opening a browser

With independently verified staging health and the existing tunnel/client ready:

```sh
node --test scripts/storage-baseline-preflight.test.mjs scripts/wall-benchmark-preflight.test.mjs
node scripts/storage-baseline-preflight.mjs --run \
 --base http://127.0.0.1:5173 --output /tmp/iq-storage-admission-new
```

The output directory must be absolute and new. Nothing is written into a
caller's existing artifacts. The controller permits at most four fixed metadata
GETs, 64 KiB per response, fifteen seconds per request and sixty seconds overall.
The only permitted base is unauthenticated loopback HTTP. It never calls prepare,
canonical/projection download, reader acquisition or history-job creation. A
failed/foreign/oversized response is recorded as an error; it cannot become an
eligible source through fallback. Native chunk planning is capped at fifteen
48-hour requests for a complete thirty-day interval. Missing history remains
unavailable/partial rather than becoming empty liquidity.

## Foreground gate remains open

The computer-use inventory returned no connected browser and reported
`The browser access host is unavailable`. The existing
[headed-launch guard](../scripts/test-browser-i3-setup.mjs) explicitly refuses
headed test browsers because desktop isolation is unverified. It was preserved;
no test window was mapped and no alternate desktop input mechanism was used.
The source preflight does not launch any browser.

Normal foreground Pi timing still needs a connected normal Chromium session or
the existing user-operated acceptance procedure. Record actual renderer,
visibility, viewport/DPR and build, then measure current/24-hour history,
seven-day composition and available thirty-day history, first useful paint,
completion, cached reopen, panning/zooming, concurrent requests and storage
failures. Keep genuine source gaps separate from rendering blanks and preserve
loaded history during failed requests. No first-paint, frame-interval, FPS or
before/after ingestion improvement is claimed here. Metadata request durations
are not chart performance samples.

## Verification and operations

[Validation/provenance](storage-baseline-evidence/validation.json) separates eleven
planner/admission tests, the native-profile contract test, typecheck and an
isolated staging bundle build. The bundle was written to an owned temporary
directory; existing frozen/preview assets and caller-owned
`artifacts/storage-baseline/` were preserved. No UI component or renderer changed.
The original [remote runtime probe](storage-baseline-evidence/remote-runtime.json)
observed both collectors live with unpaused disk guards. Its three samples per
market are availability evidence, not production tail-latency acceptance.

The client is available at `http://127.0.0.1:5173/`. Owned transient services are
`iqterminal-staging-client.service` and `iqterminal-staging-tunnel.service`;
[their observed state](storage-baseline-evidence/local-services.txt) records the
shared checkout and positive nice level. They remain running to satisfy the
earlier client/tunnel startup request. They are not enabled across reboots.
To stop only these owned local processes when no longer wanted:

```sh
systemctl --user stop iqterminal-staging-client.service iqterminal-staging-tunnel.service
```

Do not stop unrelated services or restart collectors to conduct this admission
check. Provider qualification remains a separate pending decision; the
companion backend branch's paid pilot approval has not been inferred from this
local work.

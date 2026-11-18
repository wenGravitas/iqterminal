# Order Walls: recent prepared history first

`pnpm dev:staging` enables `VITE_WALL_NEWEST_FIRST=1`. For native Top8,
10% band, no minimum-notional or confirmation filter, and requests up to
48 hours, the wall loader tries the existing prepared-history contract.
This wall-only opt-in does not enable prepared candles or footprints.
Existing `VITE_HISTORY_TILES=1` behavior remains available.

The independently validated active checkpoint is presented first. Closed,
immutable projection parts are then imported in reverse part order, using
the same contiguous server batches (at most 32 parts / 8 MiB). This prioritizes
recently prepared history; it is not a reversal of financial events. A wall
fragment is never presented until all of that wall's fragments have arrived
and passed the financial validator. Long walls spanning parts may therefore
appear later than adjacent walls.

Canonical fragment order, values, episode identities, source fences, gaps,
hash checks, final source revalidation, cache commit rules, and cancellation
remain unchanged. Final assembly restores canonical record order. Historical
coverage stays incomplete until the original completion checks pass. The
financial kernel is unchanged.

If a prepared projection is unavailable, raw/canonical updates still replay
chronologically. Custom settings and longer ranges keep their incumbent path.
Reverse raw replay or independently reseeding smaller windows would not preserve
the existing value history and aggregate statistics.

## Verification and serving route

The persistent service and standard staging routing are now enabled. See
[saved wall serving](order-walls-saved-serving.md) for deployment, current checks,
and limits. The older route observation below describes the initial implementation.

Deterministic checks cover reverse multi-batch import, split walls, exact final
checkpoint equality, partial cache reuse, corruption, changed source, abort,
native-price admission, and chronological fallback. A headless browser fixture
holds older batches back, verifies that recent walls paint first, then compares
every final wall field with the canonical reference. Fixtures do not establish
real-source correctness or foreground performance.

A separate real-route check compared both Spot and USD-M perpetual five-minute
histories with chronological raw replay at a fixed watermark: 25 and 23 walls,
respectively, matched exactly. These small histories each had one prepared part;
reverse multi-part order is covered by the deterministic/browser checks.
See [the bounded real reference](../artifacts/order-walls-newest-first/real-reference.json).

The standard staging route at remote port 18780 returned `state: missing` for
prepared discovery on the sampled range. It therefore uses the safe chronological
fallback. The real prepared comparison used the existing isolated gateway on
remote port 18880, through a temporary local forward that was removed afterward.
The normal client/tunnels were not redirected and no remote service was changed.
Prepared newest-first delivery is implemented, but is not certified as active
for the user's standard route or arbitrary historical ranges.

## Repeat the checks

Build the explicit browser-test client, then run the isolated headless checks:

```sh
VITE_DATA_MODE=staging VITE_WALL_NEWEST_FIRST=1 VITE_HISTORY_TILES=1 VITE_DIAGNOSTICS=1 pnpm build --mode staging --outDir artifacts/order-walls-newest-first/dist
pnpm exec playwright test --config playwright.order-walls-newest-first.config.ts
```

The real check is disabled by default. With an already verified local forward
to the intended prepared gateway, run:

```sh
IQ_WALL_NEWEST_FIRST_LIVE=1 IQ_WALL_REFERENCE_ORIGIN=http://127.0.0.1:18880 pnpm exec vitest run tests/order-walls-newest-first-live.test.ts
```

It requests bounded source preparation and fails if the route falls back without
delivering prepared projection parts. Do not treat that failure as permission to
restart or deploy a gateway.

# Order Book — Release 1

Order Book is the single Liquidity menu entry. New panels use Compact; saved Depth Matrix panels become Order Book in Single mode, preserving IDs, dock locations and settings. The internal legacy component alias remains for compatibility. Migration runs for active/inactive workspaces and imported layouts and is idempotent (layout version 10, `orderBookVersion: 1`).

## Controls and persistence

- Mode: Compact combines source contributions; Single retains the existing side-by-side Depth Matrix renderer. Switching is local presentation and shares source subscriptions, reference, grouping and price anchor.
- Group: Auto is a stable 100 USDT BTC grouping in R1; explicit steps include 0.1 through 1000 and 250 USDT. Resizing does not change Auto or request data. Group changes retain the previous view until a replacement page is ready, anchored at the former top visible bucket price.
- Show: Levels, Cumulative, or Levels + cumulative (default). Venue lines: Off, Top 1, Top 2. These controls are presentation-only.
- Sources: Binance BTCUSDT Spot (BIN-S) and Binance BTCUSDT USD-M perpetual (BIN-P). Other registered sources remain disabled/unavailable. There is no live fallback to fixtures.
- Reference: select a supported source. Its first usable midpoint is pinned as the cumulative origin. Recenter explicitly refreshes that anchor and centers the view. Ordinary scrolling and quote updates do not move the origin.
- Single preferences retain source order/removal, column width, BTC/USDT labels, per-source/shared quantity scales and wall settings. Compact preferences are stored separately. Hidden controls keep their values. Viewport and top price/offset are persisted.

## Data and mathematical semantics

The existing FeedClient/worker depth-matrix subscriptions and staging current-book service own data. Request grids are shared by market, exact width, range and reference price. Identical instances deduplicate requests; modes do not create exchange sockets. The existing bounded neighbor prefetch policy remains. Hidden widgets release their subscriptions and stop painting.

The optional endpoint query `cumulative=1&reference=<decimal price>` adds cumulative version 1 without changing the response version or default endpoint. Both parameters are required together. Rows and prefixes are computed synchronously from the same committed cursor/epoch/time, and echo the reference and its bucket. The worker rejects mismatched heads, anchors, grids and rows, aborts obsolete requests, and retains the painted page during replacement. Source epochs/cursors remain independent; a combined value is not an atomic cross-exchange snapshot.

Buckets are exact decimal `[low, high)` intervals. Quantities are normalized BTC and notionals sum actual raw price × quantity, not bucket midpoint × quantity. Bid and ask contributions remain separate, including mixed buckets and source price divergence. Cumulative bids walk downward and asks upward from the explicit reference bucket, independently including each side of that bucket. Off-screen scrolling does not truncate the prefix origin.

A source contributes to live combined figures only when supported, in live state, with a timestamp no older than five seconds (and no more than one second in the future). Observed/known-empty rows are exact; partial rows supply lower bounds. Unknown, disconnected, syncing and stale contributions are excluded from live totals. Retained non-live amounts are dashed outlines. Missing sources make combined coverage incomplete. Unknown values are not zeros. Each hover exposes source, side, bounds, BTC/USDT amount, cursor, epoch, age and coverage.

The service retains up to 5,000 levels per side and returns at most 2,000 rows. Coverage is snapshot bounded and may be narrower than retained observed levels. Prefixes across incomplete coverage are lower bounds drawn dashed; unknown prefixes stop. This is not full-exchange depth.

## Rendering and scales

Compact uses Canvas2D with 18px ordinary rows and 30px mixed rows, native DOM controls, the existing dirty RAF scheduler and bounded buffers. Both IQ dark and light themes are supported. Hover is text, not an additional data request.

Level stacks share the maximum displayed live side-notional denominator. The denominator rises immediately and decays over five seconds, using the incumbent scale smoother. Segment order follows selected source order. Narrow segments merge into Other while conserving amounts and width; hover lists contributors. Labels shorten from name + amount to code + amount to code, then disappear. Text measurements are bounded to 512 entries.

Total cumulative and per-source curves have separate USDT/full-width scales, displayed in the header and hover. Stable source colors are independent of bid/ask fill. Top N ranks displayed live liquidity (not traded volume), held for 30 seconds unless membership changes. The balance denominator is selected live books within displayed rows; it is marked INCOMPLETE when coverage is missing and suppresses percentages when a side is unavailable.

Single bar widths remain BTC based even with USDT labels. Existing mixed-side hover, scale and wall behavior is reused.

## Validation and operational limits

Deterministic fixture selection is explicit (`?fixture=1` in development/diagnostics). Run `pnpm exec playwright test --config playwright.order-book.config.ts` for the affected browser checks and `pnpm exec vitest run tests/order-book.test.ts tests/staging-depth-matrix.test.ts` for projection/transport tests. See the handoff for exact tested commits and results.

Panel diagnostics expose bounded synchronous render durations and input-to-render-completion samples. They do **not** measure compositor presentation or certify 60fps. Foreground Pi acceptance requires approximately 100 visible rows, two live books, alone and alongside Single: p95 synchronous paint ≤8ms and p95 interaction-to-paint ≤50ms, plus initial usable render, book age, long tasks, memory trend and request counts. Headless fixtures and captured checkpoints are separate evidence.

No production merge or deployment is included. Existing staging servers require the companion optional cumulative endpoint before live Compact cumulative acceptance. The repository currently refuses headed test browsers because desktop isolation is unverified; resolve that operational gate before foreground Pi acceptance.

## Follow-ups

Multi-venue adapters (including venue-specific quantity normalization and coverage contracts) and pull/stack are separate milestones. R1 does not enable pull/stack or interpret snapshot decreases as cancellations. It does not claim full reference-application or exchange parity.

Reference helpers were adapted from liquiditymapperfast at `be7aeb7ba772a4558704bda326405af7352a84c9`; MIT attribution is in the dependency notices and public licenses. The reference repository contained no pinned Compact screenshot, so screenshot parity remains unverified.

Deployment order: deploy and verify the companion backend before this frontend. Both modes share the cumulative-enabled subscription once a reference is pinned. An older backend rejects these parameters (verified HTTP 400 on the current staging route); the client marks the request failure rather than silently substituting unproven prefixes.

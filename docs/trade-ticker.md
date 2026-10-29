# Trade Ticker M1

Add **Trade Ticker** from the bottom toolbar. It is an ordinary dockable widget: split, group, reorder, resize and close it like a chart. Multiple tickers have independent settings. **Markets** searches the shared capability catalogue; chart market selection uses the same picker with single selection. Apply commits the draft; Cancel leaves the current selection intact.

## Available data and units

The existing execution adapter supports **Binance BTCUSDT USD-M perpetual**. Binance spot and Hyperliquid remain available for candles but disabled in the execution picker with an explanation. The picker supports multiple selections, but this milestone does not claim a second execution feed. All current choices share the BTC underlying asset. Add another normalized execution adapter before expanding the available ticker markets.

Rows show exchange UTC execution time, venue/type, aggressor side, USDT price, BTC base quantity and USDT quote notional. USDT is not labelled USD. Binance aggregate trades are **reported aggregate prints**, not individual orders ([official stream documentation](https://developers.binance.info/docs/derivatives/usds-margined-futures/websocket-market-streams/All-Market-Mini-Tickers-Stream)). Buyer-maker means aggressive sell; otherwise aggressive buy. Invalid messages are rejected by the shared adapter. Unknown aggressor sides remain unknown and can be filtered explicitly; they are never assigned buy styling.

Collection begins at subscription and retains no historical tape across reloads. Reconnect uses the existing bounded retry path and does not backfill. Connection gaps are reported; retained prints are not evidence of complete coverage. The execution service preserves its bounded ordering/deduplication policy: old or invalid executions may be discarded and counted in diagnostics. Footprints and all ticker instances share one execution socket; removing one consumer cannot close another's feed.

## Filters and tiers

**Settings** exposes a minimum trade threshold in BTC or USDT and buy/sell/both/unknown filtering. These filters apply to both rows and live sound/toast alerts for that ticker; exact threshold values qualify. Filter edits never replay alerts for retained trades. **Pause**, or scrolling away from the top, freezes the displayed tape while ingestion and classification continue; **Return to live** shows the latest retained rows.

The tier ladder has an explicitly editable common market scope. Classification remains independent of the display filter, while live alerts also require the trade to match the current filter. All thresholds in one ladder use the same unit. The highest qualifying tier wins, including the exact threshold: 1,000,000 USDT belongs to the 1m tier. Duplicate thresholds are rejected. The compact tier table edits name, minimum threshold, buy/sell colour swatches, text emphasis (**B**), brief pulse (**◇**), sound, volume percentage and toast directly in each row. **▷** tests the tier and **×** removes it; keyboard focus exposes the same controls. The table scrolls on very narrow screens and keeps its header visible for longer ladders. Defaults are silent below 100k USDT, bell from 100k, and alarm/pulse/toast from 1m. Edits apply only to future classified executions; retained prints do not replay alerts. **Test Tier** previews the row and notification without injecting a trade.

Application **Notifications** controls master mute/volume and sound previews. Each ticker also has mute. Browser audio requires an explicit user interaction after opening the app. The ticker speaker button toggles application audio; a red crossed-out speaker means audio is disabled, including master mute, zero master volume or a suspended browser audio context. Its pressed state and tooltip update across ticker instances. Turning audio off stops current tones while preserving toasts. **Test Tier** and application sound previews unlock browser audio, clear master mute and restore a zero master volume to 50%; silent tiers and zero tier volume show an explanation instead of claiming playback. Toasts remain usable without audio permission. Bell, chime and short alarm are original synthesized sine-wave scores bundled in `src/notifications.ts`; no third-party recording or external audio asset is shipped. The synthesis uses a fuller decay and a shared compressor with output headroom for overlapping alerts; saved master and tier volume controls still multiply linearly. Reduced motion disables row pulses.

## Ownership and resource limits

Worker classification is separate from visible DOM filtering and from application notification delivery. `ClassifiedTrade` is the extension point for future consumers; widget messaging and chart bubbles are not part of M1.

| Resource | Limit / policy |
|---|---|
| Ticker widgets | 8, independently of the 8-chart limit |
| Tiers | 1–12 per widget |
| Retained prints | 500 per worker pipeline and UI tape |
| Visible rows | Latest 100 matching prints retained independently of the raw buffer, virtualized to visible rows; pause freezes both bounded tapes |
| Transport | 256 pending records per widget, one acknowledged batch in flight |
| Publication / DOM paint | Worker nominal 100ms; visible DOM nominal 200ms, via existing RAF scheduler |
| Deduplication | 8,192 recent execution IDs per pipeline; shared service also bounded |
| Notifications | At most 2/s application-wide and 1/s per rule |
| Notification memory | 2,048 recent keys, 128 cooldowns, 3 visible toasts, 12 concurrent oscillator tones |

Hidden dock tabs retain bounded collection but do not paint. Notifications continue for hidden dock widgets while the browser document is visible; background browser documents suppress delivery. Stale prints older than 3 seconds, pre-subscription prints and reconnect backlog preceding the connection epoch cannot alert. Per-widget mute and master mute suppress delivery. Transport overflow discards oldest pending row records and reports a cumulative count; under sustained overload those discarded records cannot produce UI notifications. The classification itself still occurs in the worker. This is a bounded live monitor, not a lossless recording service.

Tier/settings edits change configuration generations; client revisions reject stale batches and still acknowledge them. Closing a widget releases subscriptions, scheduler entries, timers, dialogs and notification cooldown ownership. Equivalent execution consumers share the existing service. Worker diagnostics expose subscribers, pending/in-flight counts, publication totals, retained rows and drops.

Layout envelope version 4 accepts earlier versions 1–3, preserves existing chart/editor configuration and stores ticker selections/settings only. Invalid ticker settings sanitize to bounded defaults rather than breaking startup. Master notification preferences are stored separately under `basis.notifications.v1`; storage failure keeps session functionality and reports the limitation.

## Reproducible verification

```sh
pnpm test
pnpm build
VITE_DIAGNOSTICS=1 pnpm exec vite build --outDir /tmp/iqterminal-ticker
pnpm exec vite preview --host 127.0.0.1 --outDir /tmp/iqterminal-ticker --port 4181
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4181 pnpm exec playwright test tests/browser/ticker.spec.ts --reporter=list
TERMINAL_URL=http://127.0.0.1:4181 node --experimental-strip-types scripts/ticker-bench.mjs
# Ordinary production build, no fixtures:
TERMINAL_URL=http://127.0.0.1:4173 node scripts/ticker-live.mjs
```

The benchmark explicitly installs a test exchange transport, uses the real shared normalizer/classifier, keeps two 5,000-bar candle charts and adds 0/1/2/8 tickers under 500 aggregate prints/s. It records row-update p95, an independent RAF probe, long tasks, transient main-thread heap, worker diagnostics and final socket cleanup. Heap excludes worker/native/Canvas allocations. Headless Canvas2D results on the Raspberry Pi 5 do not establish native desktop V3D performance or audible sound quality. See [verification results](verification.md#trade-ticker-m1) and the linked artifacts.

The next performance task is to reduce many-widget DOM update cost and repeat the burst benchmark before claiming the frame budget. The smallest feed follow-up is a Binance spot execution adapter using the same normalized contract, capability catalogue and reference-counted ownership, then a two-market live reconciliation check. Saved aggregates, advanced ladders, bubbles, inferred grouping and historical storage remain deferred.

The ticker toolbar’s ≥ size combo accepts presets or an edited numeric value (including K/M suffixes), in BTC base quantity or USDT quote notional. It shares the display minimum with Settings; changing it filters retained rows immediately without changing the tier ladder, replaying notifications or restarting subscriptions.

Settings → Display columns controls the venue icon (compact `E` header), venue name, market type, aggressor side, price, BTC size and USDT notional independently. Time is always displayed in the Market Pulse display zone (detected Local by default, or UTC); rows retain the original UTC event instant and expose a full date and zone in their accessible name. Column choices are saved per widget; older saved tickers retain all their existing columns and gain the venue icon. An explicit empty optional-column selection displays time alone.

### Background volume bars

Each sell row has a quiet red bar extending inward from the left; each buy row has a green bar extending inward from the right. These are **reported-print size bars**, not price-level liquidity, inferred orders or cumulative volume. Unknown aggressor side has no bar. Both sides use one linear maximum: a print half the reference size has half the bar length. The largest reference print fills 45% of the row, leaving space around the centre. Bars use the BTC/USDT display-filter unit and remain underneath the text; tier pulse still works and reduced-motion preferences remain respected.

Settings → Background volume bars offers visibility (default on), scale window (default 60 seconds; 5–300 seconds), and opacity (default 18%; 0–60%). The reference includes all known-side prints from the selected ticker markets within the exchange-timestamp window, independent of display minimum, side filter and notification ladder scope. It is limited to the existing 500 retained prints, so during busy periods it can cover less than the requested time. This is explicitly shown as a window of **up to 500 prints**, not a complete rolling volume statistic. Older visible rows use the current reference and clamp at maximum width; their tooltip identifies that they are outside the scale window. When no current reference remains, bars disappear. The footer tooltip gives the reference maximum and units.

Pause freezes both the bounded row snapshot and reference clock; Return to live resumes current scaling. Hidden panels collect as before without painting. Scale expiry checks run at most once per second while visible (incoming data uses the existing 200ms paint cadence). The implementation scans at most 500 existing records per paint and uses native row background gradients: no new socket, raw tape, canvas, per-frame animation or independent render loop. Settings persist per widget and legacy layouts receive safe defaults.

The display tape retains the latest 100 matching prints independently of the 500-print raw buffer used by volume-bar scaling. Hidden small trades or opposite-side trades cannot evict an already displayed print. Only a new matching print evicts the oldest matching print when the display tape fills. Explicit filter changes rebuild from the retained matching tape plus recent raw prints, without replaying alerts; this is bounded session history, so lowering a filter cannot recover previously discarded hidden prints. Pausing freezes display rows and raw scale while live ingestion continues. Volume-bar widths remain rolling, independently of fixed execution values.

### Execution chart hover

Hover or keyboard-focus a visible execution row to show a subdued, side-coloured horizontal ray on each open chart with the same venue, market and BTC instrument. Its small dot marks the execution's exact exchange timestamp and price; the timestamp is interpolated on the chart's fractional time axis, so the ray tracks pan and zoom. Leaving the row, scrolling it out of the rendered window, clearing the tape, closing the ticker, or changing the chart instrument clears the ray. This is transient chart presentation only: it adds no native drawing, Object Tree entry, undo step, saved setting, feed subscription or history request.

Double-click a row, or focus it and press **Enter**, to add a persistent native horizontal ray at that execution's exact exchange timestamp and price. The editable **Text on ray** label carries the venue, market, side, reported print granularity, BTC quantity, execution price, quote notional and UTC time. Binance aggregate-trade labels say **AGG PRINT**: they describe an exchange-reported aggregate and do not imply an individual order. Each open chart showing the same venue, market and native instrument receives one ray; each chart records it as one ordinary drawing undo step in that chart's instrument-scoped drawing document. The ray appears in the Object Tree and can be restyled, renamed, hidden, moved or deleted through the existing drawing controls. An explicit IQTerminal custom label remains the higher-priority label override.

Hovering or focusing an execution shows a Net Longs styled card with its timestamp, venue, side, price, BTC and quote size, and bar scale when enabled. This replaces the native row tooltip; chart previews and double-click/Enter saved rays remain available.

Bybit BTCUSDT linear perpetual is selectable in ticker markets and alert scope. It uses its own shared public trade socket, individual-trade identities, BTC sizes, USDT prices and taker sides. It retains session-only semantics and does not create rays on other venues. See [Bybit support](bybit.md).

Ticker hover rays now carry the same price-axis tag styling as saved rays and positioning-zone boundaries. Hover and saved captions use a 12px venue icon and compact venue/market badge (`BN[P]`, `BN[S]`, `HL[P]`, `BY[P]`) near the right end. The saved ray's editable text retains the full execution details.

Automatic ray captions are reduced to the venue icon, badge and execution amount (`BN[P] 0.25 BTC`, for example), using the chart's effective base/quote preference. Saved rays retain base quantity and reported quote notional, so currency changes affect presentation only. Older generated ray text can supply retained amounts when available; full editable execution details stay in the drawing settings.

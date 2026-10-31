# Pane composition Release 1

Release 1 connects a script's declared numeric plot to a native SMA indicator and gives ordinary compatible studies stable, managed chart placement. The shipped workflow is the built-in Volume script feeding **SMA 20 · Volume**, with the pair in a lower pane or in a bounded band at the bottom of the price pane.

This page records the original Release 1 scope and evidence. Release 2 later adds the specifically declared CVD and raw Open Interest outputs, shared Order Flow panes, and generic SMA-consumer recovery described in [Pane composition Release 2](pane-composition-release2.md). Test totals and captures below remain historical R1 evidence.

This is local chart composition. The existing candle feed, script worker, OpenAlgo chart, and Dockview layout remain the owners of their existing data and lifecycle. It does not add another exchange connection or a new chart engine.

## Ownership

- [`src/scripts/composition.ts`](../src/scripts/composition.ts) defines bounded composition state, stable logical pane/scale/plot IDs, output-reference schemas, migration, and the SMA calculation. Persisted references use script attachment and declared output keys; renderer pane indices are runtime-only.
- [`src/scripts/host.ts`](../src/scripts/host.ts) owns script worker output, source validation, chart-context and revision checks, dependency restoration, hidden-output demand, history catch-up, and source-removal protection. Provider values remain the worker's declared numeric result arrays.
- [`src/panel.ts`](../src/panel.ts) coordinates managed pane membership, placement, price-band sizing, persistence, and cleanup. It only removes a pane whose element it captured from its managed record and which has no remaining studies, chart objects, or drawings.
- [`src/indicators/composition-controls.ts`](../src/indicators/composition-controls.ts) and [`src/indicators/composition-placement-controls.ts`](../src/indicators/composition-placement-controls.ts) provide native DOM controls. OpenAlgo retains calculation, series, and rendering ownership for the SMA.

The numeric input reference is separate from the indicator's market-series source. This lets a consumer name one provider output without changing the chart's Binance or Hyperliquid candle binding.

## Compatible sources and placement

A provider must expose a current numeric plot for the same chart candle context, with an accepted schema and a placement that the host can compose. Values are aligned to the provider's candle timestamps and carry stable attachment/output identity, units, output revision, and chart-context revision. Known compatible units can share an output scale; unknown units receive independent scale identities so unrelated values are not silently placed on one scale.

The built-in Volume histogram can feed the native SMA. The pair can move together to a managed lower pane or to the price pane's bottom band. The SMA can also move independently while retaining its input reference. The Move dialog makes moving the whole compatible group an explicit choice. The embedded height defaults to 20% and is bounded from 10% through 40%; the saved height is restored with the chart.

The host rejects self references, dependency cycles, stale or missing outputs, mixed placements, unsupported special plots, and mismatched chart contexts. Such a reference remains inactive with a recoverable status; it does not fall back to candle close or another output. Native panes and special chart layers retain their existing owners. Release 2 adds only the explicit CVD and raw Open Interest output contracts for native SMA consumption and managed pane placement; it does not convert these adapters into script studies or make arbitrary native plots composable.

## Calculation and lifecycle

The SMA reads the selected worker output through OpenAlgo's study-output source API. It requires a complete contiguous window; warm-up and null/gap windows produce nulls. A forming candle replaces its current slot. Historical corrections recalculate the affected output tail from the bounded candle snapshot. The chart does not fill missing values or use a future value.

Hiding a provider does not stop it while a visible dependent still needs its output. When the chart's script host sleeps, it marks bounded history for catch-up; it restores producers before dependent scripts. Updating the provider output causes OpenAlgo to recalculate the native SMA through the declared source link. Removing a producer with dependents is blocked with an explanation until its consumers are removed or redirected.

Moving an attached provider preserves its worker, generation, output revision, series handles, history, viewport, and candle subscription. The coordinator does not restart a feed or recompile the script as a placement side effect. Managed pane records preserve membership, order, weight, and collapse state without storing renderer indices.

## Persistence and recovery

`composition.version` is currently `1`. It stores managed pane groups, embedded price bands, logical plot presentation records, and logical scales. A plot record has a stable ID, producer instance/output key, logical pane, logical scale reference, visibility, and order. A scale record maps its stable logical ID to the current chart scale adapter ID and carries its known unit (or `null`), zero-based/automatic policy, and pane-scoped embedded-band memberships. Scale identity does not change when a plot moves between panes. No engine pane index, chart object, worker result array, or market data is persisted in these records.

If a legacy chart has script pane IDs but no composition record, migration rebuilds those groups from existing indicator IDs and seeds plot/scale records from existing pin fields. Native-owned legacy panes stay in `opaqueLegacyPanes`, which records stable owner/order links to their existing indicator settings; the native adapter retains sizing and teardown. These records never join managed groups. An explicitly present empty `indicators`, pane list, or plot list stays authoritative and does not resurrect removed entries.

Unknown fields in bounded records are retained. A future composition version is inert in this runtime: its pane arrays are not interpreted, while the bounded original record is saved in `unsupportedVersionRecord` so a later version can recover it. Unknown indicator definitions and future settings versions remain preserved by the indicator config validator and are not activated here.

On restore, producer pins are resolved before consumers. Each consumer reference is revalidated against the current producer output, schema, unit, chart context, and revision before attaching. An unavailable producer leaves the reference recoverable and the consumer inactive. Applying settings to an existing consumer retains its saved numeric reference. Replacing a provider is allowed only while its declared output remains compatible; a rejected replacement leaves the current provider and consumer pins intact. Duplicating a provider creates a distinct attachment/output identity, joins the same managed pane or band, and leaves existing consumers bound to the original provider.

## Controls

The active indicator row for a compatible script offers **Add moving average to …**. Right-clicking the script row in a chart pane opens the same native dialog. It selects the declared output and groups settings into Input, Calculation, and Display. The resulting indicator is labeled **SMA 20 · Volume**. The Move dialog selects a managed pane, a new managed pane, or the price pane; it also offers an explicit move-together checkbox and the bounded embedded-band height control. Hiding a source is allowed; removing a source with dependents is disabled and reports the reason.

## Verification evidence

Deterministic tests cover small scaled provider values, SMA warm-up and null gaps, forming replacements, bounded historical correction tails, versioned config preservation, stable scale identity across panes, opaque native-pane links, invalid references, apply/replace reference safety, source-removal blocking, and producer-first restore/catch-up. A browser workflow exercises the chart-pane right-click action, verifies logical scale/plot records and embedded-band membership through moves and reload, and checks duplicate identities plus the unchanged consumer reference. The browser workflows use the explicitly selected development fixture `/?fixture=1&fixtureTime=now`; their images are synthetic chart fixtures, not venue connectivity or live-feed evidence.

The browser geometry capture records the real OpenAlgo scale coordinates for the embedded band. At 1366×768, the 30% band has a 625 px scale, a zero baseline at y=625, the provider maximum at y=458.33, and the band top at y=437.5. At 720×860, the 717 px scale has zero at y=717, maximum at y=525.8, and band top at y=501.9. The 10% and 40% bound checks also confirmed that the maximum remains inside the requested bottom band.

- [`tests/composition-sma.test.ts`](../tests/composition-sma.test.ts), [`tests/indicator-composition-config.test.ts`](../tests/indicator-composition-config.test.ts), [`tests/openscript-host-composition.test.ts`](../tests/openscript-host-composition.test.ts), and [`tests/openscript-host-apply-race.test.ts`](../tests/openscript-host-apply-race.test.ts) cover calculations, persistence, dependencies, reference validation, and sleep catch-up.
- [`tests/browser/composition-engine.spec.ts`](../tests/browser/composition-engine.spec.ts) and [`tests/browser/composition-release1.spec.ts`](../tests/browser/composition-release1.spec.ts) exercise the installed chart engine, duplicate/reference restoration, and end-to-end workflow. Pane headers, Object Tree, and drawing sidebar regression tests also pass.
- [`artifacts/composition-band-coordinates.json`](../artifacts/composition-band-coordinates.json) contains measured coordinates; four fixture captures show lower and embedded placement at desktop and narrow sizes: [lower desktop](../artifacts/composition-volume-sma-lower-1366x768.png), [lower narrow](../artifacts/composition-volume-sma-lower-720x860.png), [embedded desktop](../artifacts/composition-volume-sma-embedded-1366x768.png), and [embedded narrow](../artifacts/composition-volume-sma-embedded-720x860.png).

The browser fixtures establish deterministic behavior and local geometry only. No live venue acceptance, production deployment, Pi run, or 60 fps claim is included.

Final local gates: `pnpm test` passes **659 tests across 86 files**, with **1 skipped test/file**; `pnpm typecheck` and `pnpm build` pass. The production build retains the existing large-chunk warning (main bundle 1,776.13 kB minified / 480.17 kB gzip). **10 targeted Chromium cases** pass across the composition engine/workflow and pane-header, Object Tree, and drawing-sidebar regressions. They ran against the local preview build with explicitly selected fixtures.

## Release boundary

Release 1 provides ordinary compatible script-output composition and the native SMA workflow. At that release boundary it did not provide composition of special native outputs. Release 2 adds the narrowly declared CVD and raw Open Interest contracts; arbitrary native indicators, mixed/special script overlays, multi-output drawing primitives, and a broader indicator scripting API still require their own source/placement contracts and verification before joining managed groups.

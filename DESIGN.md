---
name: Basis Terminal
description: Compact, dockable BTC perpetual candle inspection.
colors:
  workspace: "#080808"
  chart: "#090909"
  chrome: "#111111"
  control: "#202020"
  divider: "#292929"
  text: "#c7c7c7"
  muted: "#858585"
  up: "#58a65c"
  down: "#ad5858"
typography:
  body: {fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace", fontSize: "11px"}
  label: {fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace", fontSize: "10px"}
rounded: {control: "0px", pane: "0px"}
spacing: {panel-gutter: "4px", compact-gap: "5px", command-gap: "6px", toolbar-inset: "7px"}
components:
  button: {backgroundColor: "{colors.control}", textColor: "{colors.text}", typography: "{typography.body}", rounded: "{rounded.control}", padding: "0 6px", height: "25px"}
  button-hover: {backgroundColor: "#2b2b2b"}
  select: {backgroundColor: "{colors.control}", textColor: "{colors.text}", typography: "{typography.body}", rounded: "{rounded.control}", padding: "0 6px", height: "25px"}
  chart-toolbar-button: {backgroundColor: "{colors.control}", textColor: "{colors.text}", typography: "{typography.body}", rounded: "{rounded.control}", padding: "0 6px", height: "23px"}
  dock-tab: {backgroundColor: "{colors.control}", textColor: "{colors.text}", typography: "{typography.body}", rounded: "{rounded.pane}", padding: "0 5px", height: "26px"}
---

# Design System: Basis Terminal

## Overview

**Creative North Star: "The Quiet Market Instrument"**

Basis is a compact, full-viewport workspace for inspecting native BTC perpetual candles. The retained reference guides the dense, neutral terminal chrome; the product keeps its original Basis identity. T0 is limited to dockable candle panels for Binance BTCUSDT USD-M and Hyperliquid BTC perpetuals.

Dark retains the original almost-black plotting surfaces and neutral charcoal dock chrome. Ivory uses warm paper plotting surfaces, pale controls and dark slate text. Both retain thin dividers and small monospace controls. Green and red carry directional market meaning; metadata stays muted.

**Key Characteristics:**
- Dockable candle charts in a fixed full-viewport shell.
- Compact native controls and restrained neutral layers.
- Green/up and red/down market cues.

## Colors

Neutral layers dominate, with no separate brand-color accent. The up and down colors carry market direction; workspace, chart, chrome, controls, dividers, text, and muted text use the neutral tokens above.

**The Market Meaning Rule.** Keep green and red paired with directional market meaning; do not use them as decoration.

### Light and dark themes

Theme references:

- Light: **Ivory** — [Ivory market-profile demo](https://marketcalls.github.io/openalgo-charts/demos/market-profile/index.html?theme=ivory).
- Dark: **Dark** — the original terminal palette, guided by `docs/reference/terminal.png`. This supersedes the earlier OpenAlgo Dark demo choice.

These palettes apply to charts, dock chrome, native controls, dialogs, readouts and the script editor while retaining compact spacing, monospace typography and square controls. Dark restores the existing terminal palette over the installed OpenAlgo 2.6.0 theme defaults. Ivory's chart overrides and chrome values are adapted from the referenced demo's `themes.js` with attribution in the Licences page.

| Role | Dark | Ivory |
|---|---|---|
| Workspace | `#080808` | `#f6f4ee` |
| Plot | `#090909` | `#f6f4ee` |
| Chrome | `#111111` | `#edeae2` |
| Control / input | `#202020` / `#0d0d0d` | `#fffefa` |
| Hover | `#2b2b2b` | `#e2e6e2` |
| Divider / soft border | `#292929` / `#1b1b1b` | `#b7bcb5` / `#d1d2c9` |
| Text / muted | `#c7c7c7` / `#858585` | `#202934` / `#485667` |
| Grid / axis text | `#1d1d1d` / `#858585` | `#e9e5dc` / `#485567` |
| Up / down | `#58a65c` / `#ad5858` | `#167260` / `#b54436` |
| Active control | `#92c5cc` | `#006a73` |

The footer Theme selector offers System, Ivory (light), and Dark. A valid saved choice wins; otherwise System follows the device preference, with Dark as the fallback. System clears the saved override. Theme changes retain chart instances, manual viewports, collected data and author-selected study colours. Liquidity quantity labels choose black or white against the composited cell/background rather than using a fixed light label colour.

## Typography

One system monospace stack serves the shell, controls, tabs, and chart labels. Tabular numerals keep changing prices and times aligned. Smaller labels are reserved for OHLC and status readouts; there is no display face.

## Layout

A new or reset Dockview workspace opens with one Binance BTCUSDT USD-M candle panel and the Object Tree hidden. Saved workspaces retain their panels and explicit Object Tree visibility. A command strip stays at the bottom while each chart takes the remaining height. At widths of 900px or less, the brand and instrument metadata hide, venue status tightens, and instrument selection can shrink.

## Elevation & Depth

The interface is flat, with no shadows. Dark tonal layers and thin borders distinguish dock groups and chart toolbars. Focus uses a narrow inset outline.

## Shapes

Buttons, selects, tabs, dock panes, and chart surfaces all remain square.

## Components

Buttons share one neutral style, with a brighter charcoal hover. Chart-toolbar actions are shorter; the native venue and timeframe selects keep the same treatment. Dockview tabs follow the custom Basis theme. Each panel has a compact selector toolbar; the fixed plot-top OHLC readout is omitted. A 500 ms dwell on a painted Footprint cell opens a bounded contextual card in the shared indicator-tooltip style. Connection status sits in a compact footer below the time axis and footprint statistics; enabled heatmap metadata occupies a separate footer row. Long text truncates with the full description on hover. Retry remains visible for failed or stale data; empty/error messages stay centred in the plot.

### Order-book Heatmap

The shared catalogue and active-indicator list expose heatmap visibility and settings with compact square controls. Each candle interval owns one fixed heatmap column; forming quantities update in place. In Footprint mode the Footprint settings price level governs both layers, including fixed bucket boundaries and height; one-sided liquidity fills its row. The density palette sits behind candles and footprint marks, with bids and asks kept distinct; optional auto labels show quantity alone, sized to fit the cell with a quiet 12px cap; bid/ask side and BTC units remain explicit on hover. Hover identifies the resting side and quantity, average or peak mode, UTC time span, price range, and whether coverage is incomplete. Defaults use 0.85 opacity and full intensity at 100 BTC per $10 of price. The active toggle uses the theme accent. Settings open in a native, square dialog that stays within the viewport and scrolls at smaller sizes. Heatmap values describe observed resting liquidity, not executed trades.

## Do's and Don'ts

### Do:
- **Do** preserve the separate workspace, plot, chrome, and control layers.
- **Do** keep the original Basis identity and use green/red directionally.

### Don't:
- **Don't** copy logos or watermarks from the reference image.
- **Don't** turn flat dock panes into rounded, shadowed cards.
- **Don't** use market colors as general interface decoration.

### Tab cycling controls

The tab-strip cycle icon opens a small anchored popover just below the control, with seconds per tab and one Play/Pause icon button on the same row. Running groups show a Pause icon in the tab strip. The menu uses existing square controls, theme colours and a thin border; it clamps inside the viewport and dismisses on Escape or an outside click. No modal backdrop or central pointer travel.

### Footprint text and opacity

Bid/ask quantities grow with the price-row height and available column width, from 9px up to a restrained 24px semibold monospace. Compact rows keep compact text. Statistics appear only in the standalone Footprint Totals pane; the main chart has no embedded totals table or POC-row totals. The time axis belongs to the main price pane. Standalone totals use brighter 11px text and 18px default rows; optional row-maximum highlights use a thin neutral outline and bold text, with ties included across visible candles. Executed cell backgrounds default to 85% opacity (15% transparency), independently adjustable in Footprint display settings. Heatmap backgrounds retain their own opacity control and use muted, theme-aware liquidity colours with smaller labels so executed footprint cells remain in the foreground. Text remains opaque; saved explicit heatmap opacity is respected.

### Pane data readiness

Empty chart and indicator panes show a compact five-bar signal animation with the loading task and source detail. The signal uses the theme accent and becomes static under reduced motion; narrow plots show the signal alone with a full accessible label. Loading feedback yields to usable data without covering retained values. Empty results, unavailable sources and errors use static text rather than an endless animation. Pane headers, input and pane layout controls remain interactive. Market Conditions and Depth Matrix share the same feedback component.

### Effort–Result observations

Small directional zone segments begin at actual candidate availability, with a diamond marker and restrained R/B/U/? outcome notation. Buy-flow stalls use resistance red and sell-flow stalls support green. Segments stop at resolution; candles retain their original appearance. A compact status/evidence button has its own reserved chart-footer row below the plot and footprint totals. Hover evidence uses a flat theme surface and expandable provenance; the optional signed pane labels intensity as descriptive and shows warm-up/quality feedback rather than plotting missing observations as zero.

When VAH/VAL guides are visible, POC dotted vertical markers share their horizontal endpoints, including the central candle gutter, guide extensions and chart-edge clipping. With value-area guides hidden, the markers retain their compact clearance from the painted POC cells.

### Floating drawing toolbar

A sidebar icon toggles a flat, square floating bar inside each chart. Pointer and Erase are fixed; an empty bar prompts “Drag drawing tools here”. Pinned tools reuse the sidebar icons and native tool state. Tool drags use a compact theme-matched icon-and-name preview. A small grip moves the bar, which wraps and stays inside its chart as available space changes. Pins are copied from sidebar tools and can be reordered without creating drawings. Per-chart visibility, normalized position and tool order persist with the layout; native tool defaults and templates remain authoritative.

### Multi-Venue CVD

The native lower pane reuses Net Positioning source-button sizing, selected state and keyboard focus for Venues/Aggregations, the shared market picker for inclusion, and a separately labelled legend for visibility. Thin stable source colours sit behind a thicker foreground-coloured total, with a subtle dashed zero and breaks at UTC resets. Compact quantity readouts name the unit; unknown samples remain gaps and qualified partial totals use dashed segments. Controls and legend occupy reserved space at the top; narrow panes scroll their legend rather than stacking overlapping end labels. Coverage stays in one subdued footer and the compact crosshair tooltip; details remain in diagnostics.

### Order Walls Top Levels

Top Levels uses a compact set of continuous native horizontal selection episodes, with four shared strength tiers and distinct bid/ask hues. The strongest levels have brighter warm colours and greater width; small quantity/rank changes remain within a line. Visible Range Only scales appearance independently of detection. Optional right-edge price/notional labels suppress overlaps. Native settings are grouped into Detection, Appearance and History, with confirmation advanced controls collapsed. Pending replay, partial observed ranking scope, unknown removals and evicted detail remain explicit. Existing Threshold Walls settings retain their mode.

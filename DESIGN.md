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

Almost-black plotting surfaces hold the focus. Charcoal dock chrome, thin dividers, and small monospace controls frame each chart. Green and red carry directional market meaning; metadata stays muted.

**Key Characteristics:**
- Dockable candle charts in a fixed full-viewport shell.
- Compact native controls and restrained neutral layers.
- Green/up and red/down market cues.

## Colors

Neutral layers dominate, with no separate brand-color accent. The up and down colors carry market direction; workspace, chart, chrome, controls, dividers, text, and muted text use the neutral tokens above.

**The Market Meaning Rule.** Keep green and red paired with directional market meaning; do not use them as decoration.

## Typography

One system monospace stack serves the shell, controls, tabs, and chart labels. Tabular numerals keep changing prices and times aligned. Smaller labels are reserved for OHLC and status readouts; there is no display face.

## Layout

Dockview opens with two side-by-side candle panels. A command strip stays at the bottom while each chart takes the remaining height. At widths of 900px or less, the brand and instrument metadata hide, venue status tightens, and instrument selection can shrink.

## Elevation & Depth

The interface is flat, with no shadows. Dark tonal layers and thin borders distinguish dock groups and chart toolbars. Focus uses a narrow inset outline.

## Shapes

Buttons, selects, tabs, dock panes, and chart surfaces all remain square.

## Components

Buttons share one neutral style, with a brighter charcoal hover. Chart-toolbar actions are shorter; the native venue and timeframe selects keep the same treatment. Dockview tabs follow the custom Basis theme. Each candle panel has a compact selector toolbar, OHLC readout at the plot top, and status at the lower right; retry appears for failed or stale data.

## Do's and Don'ts

### Do:
- **Do** preserve the separate workspace, plot, chrome, and control layers.
- **Do** keep the original Basis identity and use green/red directionally.

### Don't:
- **Don't** copy logos or watermarks from the reference image.
- **Don't** turn flat dock panes into rounded, shadowed cards.
- **Don't** use market colors as general interface decoration.

# Native chart drawings

## Create and edit drawings

On Binance BTCUSDT Spot, Binance BTCUSDT USD-M Perpetual, and Hyperliquid BTC Perpetual candle charts, choose from the left drawing sidebar: **Lines** contains trend line, horizontal line, and horizontal ray; **Shapes and Fibonacci** contains rectangle and Fibonacci retracement; **Position tools** contains long and short position; **Text** adds an annotation. The cursor/select control sits above these groups. Group icons use the last selected tool, and their chevrons open the related tools. Horizontal lines, rays, and text finish with one anchor; trend lines, rectangles, Fibonacci retracements, and position boxes finish with two.

The anchor icon cycles **Off → Weak → Strong → Off** snapping to candle values; holding Ctrl/⌘ temporarily enables strong snapping. The active tool or erase mode has a pressed state in the sidebar and is announced to assistive technology. Click the chart to place anchors. A preview is temporary; the drawing is saved and enters native Undo/Redo history when placement completes. Undo, Redo, Erase, Style, Templates, and Objects stay in the same sidebar.

Select a drawing and use **Style** in the sidebar or its Objects row to edit the native controls available for that tool, its interval range, and IQTerminal metadata. Shape controls include fill and opacity; Fibonacci controls include editable levels and label visibility. A custom label is drawn at the anchor of horizontal lines and rays using the drawing's text style. Their numeric price tags appear in the native price scale in the drawing's stroke color, not beside the ray's start point. The custom annotation stays at its anchor, follows the stroke color until a user explicitly chooses **Text color**, and templates preserve that choice; the native Text tool continues to render its `Drawing.text.value` once. The analysis interval is a separate annotation from visibility: a drawing tagged **4h** can remain visible on a 1m chart. Its **From** and **To** interval range controls where it appears, and **Hide/Show** is an independent visibility switch. Applying a template or changing an analysis interval does not switch the chart timeframe.

The Objects panel follows the active candle chart and groups rows under the main pane or their actual chart pane. Rows within each pane retain the native object inventory order. The primary source row cannot be removed. Drawing rows provide **Hide/Show**, **Lock/Unlock**, **Duplicate**, **Style**, and remove actions. The inventory also exposes Footprint, Order-book Heatmap, Order Walls, Level Watch zones, and script-backed studies when those providers are active. Provider rows offer only their supported actions; script studies expose visibility, settings, and removal, with no lock action. Undo and Redo buttons work with **Ctrl/⌘+Z** and **Ctrl/⌘+Shift+Z**; **Ctrl/⌘+D** duplicates the selected drawing. Drawing tool hotkeys are shown by their native toolbar controls when available.

## Templates

Open **Templates** with a drawing selected to save its settings under a name. Records are scoped to a tool; saving the same name for that tool updates the record. **Include label** is independent of the label field: leave it off to preserve the target drawing's current annotation when applying, or turn it on to copy the text. An included empty label explicitly clears the target label.

Applying a template changes the selected drawing's settings in one undo step while keeping its anchors and identity. It copies settings into that drawing; later edits or deletion of the catalog record do not change drawings that were already applied. **Set default** uses the template for later placements of that tool. Favorites stay at the top of the template list.

## Saved data

Each chart panel stores a separate drawing document for each instrument in browser `localStorage`, under `iqterminal:drawings:<encoded panel id>:<encoded venue:market>:<encoded symbol>`. The chart interval is outside the key, so changing timeframe keeps the same instrument's drawings. Spot, USD-M perpetual, and Hyperliquid perpetual have distinct scopes. Chart layout restoration retains panel IDs; closing a chart disposes its live controller but does not delete the saved document for that panel and instrument. A newly created chart has its own panel scope.

Templates use the separate versioned catalog `iqterminal:drawing-templates:v1`. Malformed or unsupported stored drawing/template data is left untouched; the affected feature uses an in-memory session copy and reports the storage issue. If a drawing-document write fails, drawings remain usable in the current session but edits made after the failure are not guaranteed to survive a reload.

## Verification limits

`tests/browser/drawing-tools.spec.ts` uses the explicitly selected fixture mode. It covers each tool's anchor count, settings and template history, Objects actions and active-panel ownership, instrument/panel storage, write failures and corrupt data, Footprint/Heatmap overlays, and Level Watch visibility and picker disarming. `tests/drawing-templates.test.ts` covers catalog parsing and repository behavior. Fixture browser checks do not certify live Binance or Hyperliquid connectivity or platform frame-rate performance.

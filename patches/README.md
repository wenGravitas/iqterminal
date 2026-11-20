# Local dependency patches

## openalgo-charts 2.6.0

Price-axis drags must measure movement in the pane where the drag began.
The upstream `_onPointerMove` price branch subtracts `_axisStartCoord` from
`t.localY`, which is relative to the pane currently under the pointer. Crossing
into an indicator pane therefore jumps the price range.

The patch uses `t.y - (this._host._paneLayout()[this._downPane]?.top ?? 0)`
instead of `t.localY` in that branch. The original pointer capture, selected
scale, release/cancel handling and invalidation remain owned by the engine.
Only the ESM entry used by this application is patched; the standalone bundle
is not used. The distributed entry is minified on one line, so the generated
patch includes that whole line despite changing one expression.

Regression: `tests/browser/price-scale-drag.spec.ts` checks continuous scaling
across the pane boundary, outside the chart, and stopping on release.

# Net Longs & Shorts range totals

Hold the left mouse button on a Longs or Shorts bar and drag left or right. The highlighted columns and tooltip sum that side's candle changes across the selected venues, including both endpoint candles. Release the mouse to clear a dragged measurement.

For a pinned measurement, click a bar once, move to a second bar in the same side, and click again. The range remains until its × button is clicked, Escape is pressed, another measurement replaces it, or its chart/indicator is hidden, removed or changed. Same-bar double-click retains the existing price-zone action. Pins are temporary chart state, not saved drawings.

Totals use the current BTC/quote display and source selection. In cumulative mode they sum the underlying candle changes, rather than adding running inventory-like levels. Missing candles or venue observations make the result a subtotal; unknown values are not presented as observed zeros. Live positioning updates refresh an active measurement. Chart time mapping uses the existing shared data layer. Measuring does not pan the chart or fetch additional history.

The selection and tooltip use the shared visible-chart scheduler, native DOM, existing theme tokens and hover-tooltip rendering. Capture/listeners/DOM are released on disposal; drawing-placement, eraser, touch and control interactions retain their existing behavior.

Validation: 28 Net Positioning layout/range tests passed, full frontend build/typecheck passed, and the isolated headless Chromium UI test passed. The UI test covers both range directions, inclusive bar counts, an independently summed displayed quantity, clear-on-release, unchanged time viewport, click-to-pin, close and Escape. Dark and Ivory screenshots were inspected. These use explicit deterministic market inputs, not live venue performance evidence.

```sh
pnpm exec vitest run tests/net-positioning-layout.test.ts
pnpm exec playwright test --config tests/browser/net-positioning-range.playwright.config.ts
pnpm build
```

The browser configuration uses its own loopback Vite port 5187, does not reuse the user's client and requires no staging tunnel. Existing bundle-size warnings remain. The mechanical design scan found only pre-existing palette advisories elsewhere in `style.css`.

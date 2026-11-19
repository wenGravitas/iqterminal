# Net Positioning values during zoom

The pane previously treated a native-candle array offset as a shared chart logical index. Other series can extend that shared axis with earlier timestamps or gaps. Zoom/history updates could consequently move a value to a different candle, show a different amount at the original position, or drop the value from the visible window. The initial label-width fix did not address this mapping error.

The mounted pane now resolves shared logical indices to UTC timestamps before reading a Net Positioning candle. Drawing, visible-scale selection, diagnostics and hover geometry use that same identity. Full-label fit checks remain: amounts that cannot fit are omitted rather than partially painted.

Evidence in `artifacts/net-positioning-time-alignment/` uses frozen explicit fixture data in the actual mounted chart. Before the fix, inserting five earlier shared-axis timestamps removed the 238 bar from its expected position despite its unchanged source value. After the fix it stays at x239.5 (expected239.08), remains correctly mapped when zoomed out, hides the full label at narrow spacing, and returns as238 after zooming back. Both Longs and Shorts were observed. This is deterministic browser evidence, not live-data acceptance or a performance measurement.

Validation: 22 layout tests, typecheck/production build, and the mounted Chromium shared-axis expansion plus zoom round-trip passed. The regression covers source values, visible-scale membership and hover timestamp before/after inserted history.

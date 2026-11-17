# Bounded chart work per RAF callback

The incumbent scheduler coalesces every dirty visible chart into one callback.
When several historical charts are expensive, it draws all of them before input
and message tasks can run. Deterministic20msdraws demonstrate the old60msburst
and delayed remaining work; the old-source counterfactual fails.

The same single scheduler now checks an8mselapsed soft budget after each chart.
It leaves remaining dirty charts queued for another RAF. Removal still releases
queued references; hidden work remains dormant, new invalidations remain queued,
and a self-invalidating chart joins the tail rather than starving waiting charts.
Explicit single-chart synchronous flush remains available for screenshots.

A chart draw is still synchronous and can exceed8ms. This does not split native
cell painting or promise an8msframe/60fps. It prevents combining multiple costly
draws into the same callback; individual long tasks still require measurement
and improvement. No cell/bar budget, financial data, chart kernel, source, order
of data application or number of contexts changes. Repeated data updates coalesce
through the existing chart state; deferred charts paint their latest state.

Renderer diagnostics expose shared scheduler frames/draws/yields, lifetime
elapsed maxima and current dirty/drawing counts. These global counters are
repeated per-panel for inspection and must not be summed across panels. Elapsed
time includes scheduling effects and is not pure CPU time. No unbounded trace,
worker, canvas or queue is added.

Tests cover budget yielding, FIFO fairness under self-invalidation, removal,
single-chart flush, hidden/disposed work and existing nested-flush behavior.
Production browser measurements must establish actual responsiveness. Rollback:
remove the elapsed-budget break/diagnostics and rebuild the client; no backend,
live socket, source or cursor operation is involved.

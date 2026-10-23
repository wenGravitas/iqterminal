import { VERSION, type Chart } from 'openalgo-charts';

/** OpenAlgo 2.6.0 has no public time-axis pane selector. Its one layout owner is
 * shared by rendering, plot geometry, axis hit testing and pane sizing. Redirect
 * that owner together, rather than moving canvas pixels or duplicating an axis.
 * Keep this compatibility seam explicit and recheck it before a library upgrade.
 */
export function anchorTimeAxisToPrimary(chart: Chart) {
  const layout = (chart as unknown as { _layout?: { _bottomPaneIndex?: (skipCollapsed?: boolean) => number } })._layout;
  if (VERSION !== '2.6.0' || typeof layout?._bottomPaneIndex !== 'function') {
    throw new Error('Primary time-axis placement requires the pinned OpenAlgo Charts 2.6.0 layout contract');
  }
  layout._bottomPaneIndex = () => chart.primaryPaneIndex();
}

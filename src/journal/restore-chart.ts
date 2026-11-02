import type { Chart } from 'openalgo-charts';
import { parsePaneState } from 'openalgo-charts';
import type { RestoredChart } from './restore';
import { immutableCopy } from './model';

export interface RestoreChartPort { chart: Chart; signal: AbortSignal; paneForInstance(id: string): number; setDrawings(document: unknown): void; sourceStyle(style: Record<string, unknown>): void; sourceScale(id: import('openalgo-charts').PriceScaleId): boolean; setObjectTree(catalog: RestoredChart['objectTree']): void; report(warnings: string[]): void; alive(): boolean }
export function restoreChart(port: RestoreChartPort, restored: RestoredChart): Promise<string[]> {
  return new Promise(resolve => {
    const warnings = [...restored.warnings]; let applied = false, scheduled = false; const releases: (() => void)[] = [];
    const finish = (force = false) => {
      if (applied) return;
      if (!port.alive()) { applied = true; clearTimeout(deadline); releases.forEach(release => release()); resolve([...warnings, 'Restored chart was closed before settings could be applied.']); return; }
      const paneMap = new Map<number, number>(), current = port.chart.panes(); let missing = false;
      for (const pane of restored.snapshot.panes) {
        const members = pane.members.map(id => restored.instanceIds.get(id) ?? id);
        const index = pane.primary ? port.chart.primaryPaneIndex() : members.map(id => port.paneForInstance(id)).find(index => index >= 0);
        if (index !== undefined && index >= 0) paneMap.set(pane.capturedIndex, index); else if (members.length) missing = true;
      }
      if (!force && (!port.chart.dataLayer.length || missing)) return;
      applied = true; clearTimeout(deadline); releases.forEach(release => release());
      const document = JSON.parse(JSON.stringify(restored.drawings));
      const skipped: string[] = []; document.drawings = (document.drawings ?? []).flatMap((drawing: any) => { const index = paneMap.get(drawing.paneIndex ?? 0); if (index === undefined) { skipped.push(drawing.id); return []; } return [{ ...drawing, paneIndex: index }]; });
      if (skipped.length) warnings.push(`${skipped.length} drawing(s) belong to unavailable panes and were not placed on another pane. The capture retains them.`);
      port.setDrawings(document); port.setObjectTree(restored.objectTree);
      const descriptors = restored.snapshot.nativeState.series;
      if (Array.isArray(descriptors)) { const source = descriptors.find((series: any) => series.paneIndex === restored.snapshot.panes.find(pane => pane.primary)?.capturedIndex && ['candlestick', 'ohlc', 'line', 'area'].includes(series.type)); if (source?.style) { const { visible: _visible, ...style } = source.style; port.sourceStyle(style); } if (source?.priceScaleId && !port.sourceScale(source.priceScaleId)) warnings.push('The saved source price axis could not be assigned.'); }
      const nativePanes = restored.snapshot.nativeState.panes;
      if (Array.isArray(nativePanes)) for (const [oldIndex, index] of paneMap) {
        try { const state = parsePaneState(nativePanes[oldIndex]), pane = current[index]; if (!pane) continue;
          port.chart.setPaneWeight(index, state.weight);
          const apply = (scale: typeof pane.priceScale, values: any) => { const { range, autoScale, placement: _placement, indicatorRange: _indicatorRange, ratioLock: _ratioLock, ...options } = values; scale.setOptions(options); scale.setAutoScale(autoScale); if (!autoScale && range) scale.setPriceRange(range); };
          apply(pane.priceScale, state.priceScale); if (state.priceScale.placement) pane.setAxisPlacement('right', state.priceScale.placement.side, state.priceScale.placement.order);
          for (const [id, values] of Object.entries(state.scales ?? {})) { const target = (restored.scaleIds.get(id) ?? id) as import('openalgo-charts').PriceScaleId; if (pane.usesScale(target)) { apply(pane.scaleFor(target), values); if (values?.placement) pane.setAxisPlacement(target, values.placement.side, values.placement.order); } else warnings.push(`Scale ${id} has no restored producer; its saved manual range was not assigned to another scale.`); }
          if (state.collapsed && index !== port.chart.primaryPaneIndex()) port.chart.setPaneCollapsed(index, true);
        } catch { warnings.push(`Pane ${oldIndex + 1} scale settings could not be restored.`); }
      }
      const range = restored.snapshot.visibleRange;
      if (range && port.chart.dataLayer.length) {
        const data = port.chart.dataLayer, first = data.indexToTime(0)! * 1000, last = data.indexToTime(data.length - 1)! * 1000;
        if (range.from < first || range.to > last) warnings.push('Some saved dates are outside currently available history. Empty regions are not replayed or substituted.');
        port.chart.setVisibleLogicalRange({ from: data.timeToIndexFloat(range.from / 1000), to: data.timeToIndexFloat(range.to / 1000) });
      } else warnings.push('No current candle history is available for the saved viewport. Use the original screenshot as the record.');
      if (missing) warnings.push('Some captured indicator panes are unavailable; their captured settings remain in the journal.');
      const result = [...new Set(warnings)]; port.report(result); resolve(result);
    };
    const schedule = () => { if (scheduled || applied) return; scheduled = true; queueMicrotask(() => { scheduled = false; finish(); }); };
    for (const event of ['data:update', 'paneAdded', 'paneMoved'] as const) releases.push(port.chart.on(event, schedule));
    const deadline = setTimeout(() => finish(true), 8000); port.signal.addEventListener('abort', () => finish(true), { once: true }); schedule();
  });
}

export function showRestoredNotice(footer: HTMLElement, warnings: readonly string[]) {
  let notice = footer.querySelector<HTMLDetailsElement>('.journal-restored-notice');
  if (!notice) { notice = document.createElement('details'); notice.className = 'journal-restored-notice'; footer.append(notice); }
  const summary = document.createElement('summary'); summary.textContent = 'Restored settings · current history, not replay';
  const text = document.createElement('p'); text.textContent = warnings.join('\n'); notice.replaceChildren(summary, text);
}

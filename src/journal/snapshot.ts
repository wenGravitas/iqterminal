import { version as engineVersion, type Chart } from 'openalgo-charts';
import type { DrawingController } from 'openalgo-charts/draw';
import type { PanelConfig } from '../panel';
import type { IQObjectTreeCatalog } from '../chart/object-tree';
import { canonicalMarket, publicCaptureCopy, type ChartSnapshot, type LayerCoverage, type SnapshotPane } from './model';

export interface SnapshotInput {
  display: { timezone: string; theme: string; currency: unknown }; candleState: { count: number; firstTime: number | null; last: unknown };
  config: PanelConfig; chart: Chart; drawings: DrawingController; objectTree: IQObjectTreeCatalog;
  paneForInstance(id: string): number; layers: LayerCoverage[]; dataAsOf: number | null;
}
const CONFIG_KEYS: readonly (keyof PanelConfig)[] = ['venue', 'market', 'interval', 'type', 'indicators', 'studies', 'indicatorVersion', 'paneOrder', 'composition', 'basePriceVisible', 'grid', 'wheelMode', 'drawingMagnet', 'rowPrice', 'footprintUnits', 'footprint', 'heatmap', 'candleElapsedTimer', 'floatingDrawingToolbar'];
export function freezeSnapshot(input: SnapshotInput, capturedAt: number): ChartSnapshot {
  const { chart, config } = input;
  const savedConfig = Object.fromEntries(CONFIG_KEYS.filter(key => config[key] !== undefined).map(key => [key, config[key]]));
  const panes: SnapshotPane[] = chart.panes().map((_, index) => {
    const primary = index === chart.primaryPaneIndex(), members = config.indicators.filter(instance => input.paneForInstance(instance.instanceId) === index).map(instance => instance.instanceId);
    const managed = config.composition.panes.find(pane => pane.memberIds.some(id => members.includes(id)));
    return { id: primary ? 'price' : managed?.id ?? (members.length ? `owner:${members[0]}` : `unowned:${index}`), capturedIndex: index, members, primary };
  });
  const state = chart.getState() as unknown as Record<string, unknown>;
  const { alerts: _alerts, ...nativeState } = state;
  const range = chart.getVisibleLogicalRange();
  const from = range ? chart.dataLayer.indexToTimeFloat(range.from) * 1000 : NaN, to = range ? chart.dataLayer.indexToTimeFloat(range.to) * 1000 : NaN;
  return publicCaptureCopy({ version: 1, app: 'iqterminal/0.1.0', engine: engineVersion(), capturedAt, market: canonicalMarket(config), config: savedConfig,
    nativeState, display: input.display, candleState: input.candleState, panes, drawings: input.drawings.toJSON() as unknown as Record<string, unknown>, objectTree: input.objectTree as unknown as Record<string, unknown>,
    visibleRange: Number.isFinite(from) && Number.isFinite(to) ? { from: Math.round(from), to: Math.round(to) } : null, dataAsOf: input.dataAsOf, layers: input.layers,
    scripts: config.indicators.filter(instance => instance.script).map(instance => ({ instanceId: instance.instanceId, scriptId: instance.script!.scriptId, revisionId: instance.script!.revisionId, contentHash: null })),
    warnings: ['Restoring settings uses currently available history, not replay.', ...(config.tradingOverlay ? ['Trading-account overlay settings are excluded from restoration.'] : []), ...panes.filter(pane => pane.id.startsWith('unowned:')).map(pane => `Pane ${pane.capturedIndex + 1} has no stable owner; restoration may omit it.`)],
  });
}

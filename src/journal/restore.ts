import { compositionPaneId, numericOutputScaleId, compositionScaleId } from '../scripts/composition';
import { migrateDrawings } from 'openalgo-charts/draw';
import { config, type PanelConfig } from '../panel';
import { parseIQObjectTreeCatalog, type ObjectTreeEntry } from '../chart/object-tree';
import { marketSeries, type ChartSnapshot } from './model';
import type { ScriptLibrary } from '../scripts/library';

export interface RestoredChart { config: PanelConfig; drawings: Record<string, unknown>; objectTree: ReturnType<typeof parseIQObjectTreeCatalog>; snapshot: ChartSnapshot; paneIds: Map<string, string>; instanceIds: Map<string, string>; scaleIds: Map<string, string>; warnings: string[] }
/** Remap identity references, including embedded output/scale IDs, without touching titles or notes. */
function remap(value: any, ids: Map<string, string>, key = ''): any {
  if (['definitionId', 'scriptId', 'revisionId', 'title', 'name', 'contentHash'].includes(key)) return value;
  if (typeof value === 'string') { let result = value; for (const [old, fresh] of [...ids].sort((a, b) => b[0].length - a[0].length)) { if (result === old) return fresh; if (/^(?:pane:|output:|plot:|scale:|overlay:|composition:|numeric:)/.test(result)) result = result.split(old).join(fresh); } return result; }
  if (Array.isArray(value)) return value.map(item => remap(item, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child, ids, key)]));
  return value;
}
export async function prepareRestore(snapshot: ChartSnapshot, library: ScriptLibrary): Promise<RestoredChart> {
  const series = marketSeries(snapshot.market, snapshot.config.interval); if (!series) throw Error('This exact market or aggregation is not supported for restoration. No substitute was opened.');
  const original = config(snapshot.config), ids = new Map<string, string>(), instanceIds = new Map<string, string>(), paneIds = new Map<string, string>();
  for (const instance of original.indicators) { const fresh = `journal-${crypto.randomUUID()}`; instanceIds.set(instance.instanceId, fresh); ids.set(instance.instanceId, fresh); }
  // Native singleton IDs can be remapped: definitionId remains the native registration key.
  for (const pane of snapshot.panes) { const fresh = pane.primary ? 'price' : `journal-pane-${crypto.randomUUID()}`; paneIds.set(pane.id, fresh); if (!pane.primary) ids.set(pane.id, fresh); }
  for (const pane of original.composition.panes) if (!ids.has(pane.id)) { const fresh = `journal-pane-${crypto.randomUUID()}`; ids.set(pane.id, fresh); paneIds.set(pane.id, fresh); }
  const scaleIds = new Map<string, string>();
  for (const instance of original.indicators) for (const unit of ['BTC', 'USDT'] as const) { const fresh = instanceIds.get(instance.instanceId)!; const oldScale = numericOutputScaleId(compositionPaneId(instance.instanceId), '', unit), newScale = numericOutputScaleId(compositionPaneId(fresh), '', unit); ids.set(oldScale, newScale); ids.set(compositionScaleId(oldScale), compositionScaleId(newScale)); scaleIds.set(oldScale, newScale); }
  const settings = remap(original, ids) as PanelConfig, warnings = [...snapshot.warnings, 'Restored settings use currently available history. Historical indicators may differ from the original screenshot.', 'Workspace theme, timezone and currency remain the current workspace preferences; their captured values are retained as evidence.'];
  for (const instance of settings.indicators) {
    const oldId = [...instanceIds].find(([, fresh]) => fresh === instance.instanceId)?.[0];
    if (instance.script) {
      const evidence = snapshot.scripts.find(script => script.instanceId === oldId), local = await library.getRevision(instance.script.scriptId, instance.script.revisionId).catch(() => null);
      if (!local || !evidence?.contentHash || evidence.contentHash !== local.contentHash) {
        instance.visible = false; instance.source = { kind: 'journal-unavailable' }; warnings.push(`Script ${instance.script.title} is unavailable or its exact hash is unverified. Archived source was not executed.`);
      }
    }
  }
  settings.tradingOverlay = false;
  const document = migrateDrawings(snapshot.drawings), drawingIds = new Map(document.drawings.map(drawing => [drawing.id, `journal-drawing-${crypto.randomUUID()}`]));
  const drawingDocument = remap(document, drawingIds);
  const tree = parseIQObjectTreeCatalog(snapshot.objectTree);
  const remapTree = (entries: ObjectTreeEntry[]): ObjectTreeEntry[] => entries.map(entry => entry.type === 'drawing' ? { ...entry, drawingId: drawingIds.get(entry.drawingId) ?? entry.drawingId } : entry.type === 'indicator' ? { ...entry, indicatorId: instanceIds.get(entry.indicatorId) ?? entry.indicatorId } : { ...entry, id: `journal-folder-${crypto.randomUUID()}`, children: remapTree(entry.children) });
  return { config: settings, drawings: drawingDocument, objectTree: { ...tree, entries: remapTree(tree.entries) }, snapshot, paneIds, instanceIds, scaleIds, warnings };
}

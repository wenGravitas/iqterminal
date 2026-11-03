import { config } from '../../src/panel';
import { canonicalMarket, createEntry, immutableCopy, type ChartSnapshot, type JournalBundle } from '../../src/journal/model';
import { captureRecord } from '../../src/journal/capture';
export const journalTime = Date.UTC(2026, 9, 31, 12);
export function journalSnapshot(): ChartSnapshot {
  const settings = config({ venue: 'binance', market: 'perpetual', interval: '1m' });
  return immutableCopy({ version: 1, app: 'test', engine: '2.6.0', capturedAt: journalTime, market: canonicalMarket(settings), config: settings as unknown as Record<string, unknown>, nativeState: { version: 1, panes: [{ weight: 1, priceScale: { autoScale: true, mode: 'normal', marginTop: .1, marginBottom: .1, minMove: .1, inverted: false } }] }, panes: [{ id: 'price', capturedIndex: 0, primary: true, members: [] }], drawings: { version: 1, drawings: [], groups: [] }, objectTree: { version: 1, revision: 0, entries: [] }, visibleRange: { from: journalTime - 3600000, to: journalTime }, dataAsOf: journalTime, layers: [{ layer: 'candles', source: 'binance:perpetual', dataAsOf: journalTime, from: journalTime - 3600000, to: journalTime, quality: 'live', gaps: [] }], scripts: [], warnings: [] });
}
export function journalBundle(id = 'entry-one'): JournalBundle { const capture = captureRecord(journalSnapshot(), `capture-${id}`, null, null, ['Explicit note-only test'], journalTime - 60000); const entry = { ...createEntry(capture, journalTime - 60000, journalTime), id }; return { capture, entry, assets: [] }; }
export const pngBytes = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fz8AAAAASUVORK5CYII='), char => char.charCodeAt(0));

import { canonicalSeries, instrumentOf, type CanonicalSeries } from '../feed/protocol';

export const JOURNAL_VERSION = 1 as const;
export const JOURNAL_LIMITS = { entriesPerImport: 1000, archiveBytes: 100 * 1024 * 1024, assetBytes: 20 * 1024 * 1024, snapshotBytes: 8 * 1024 * 1024, note: 32000, tags: 24, revisions: 200, query: 500 } as const;
export interface JournalMarket { venue: string; market: string; symbol: string; aggregation?: { version: number; members: unknown[] } }
export interface LayerCoverage { layer: string; source: string; dataAsOf: number | null; from: number | null; to: number | null; quality: string; gaps: { from: number; to: number }[]; detail?: string }
export interface ReplayManifest { version: 1; market: JournalMarket; requestedRange: { from: number; to: number } | null; captureCutoff: number | null; warmup: 'unknown'; warmupRequirements?: { instanceId: string; bars: number }[]; streams: LayerCoverage[]; retention: 'unpreserved'; playback: 'not-implemented'; screenshot: boolean; chartState: true }
export interface SnapshotPane { id: string; capturedIndex: number; members: string[]; primary: boolean }
export interface ChartSnapshot {
  version: 1; app: string; engine: string; capturedAt: number; market: JournalMarket; config: Record<string, unknown>;
  nativeState: Record<string, unknown>; panes: SnapshotPane[]; drawings: Record<string, unknown>; objectTree: Record<string, unknown>;
  visibleRange: { from: number; to: number } | null; dataAsOf: number | null; layers: LayerCoverage[];
  scripts: { instanceId: string; scriptId: string; revisionId: string; contentHash: string | null; source?: string }[];
  warnings: string[];
  display?: { timezone: string; theme: string; currency: unknown };
  candleState?: { count: number; firstTime: number | null; last: unknown };
}
export interface ChartCapture { version: 1; id: string; capturedAt: number; snapshot: ChartSnapshot; replay: ReplayManifest; image: string | null; thumbnail: string | null; imageStatus: 'complete' | 'partial' | 'note-only'; imageWarnings: string[] }
export interface JournalReasoning { thesis: string; confirmation: string; invalidation: string; plannedAction: string }
export interface NoteRevision { at: number; kind: 'original' | 'edit' | 'reflection'; title: string; note: string; tags: string[]; reasoning: JournalReasoning }
export interface JournalEntry { version: 1; id: string; captureId: string; market: JournalMarket; instrument: string; marketTime: number; createdAt: number; capturedAt: number; annotation: 'current' | 'historical'; updatedAt: number; title: string; note: string; tags: string[]; reasoning: JournalReasoning; revisions: NoteRevision[] }
export interface JournalAsset { id: string; blob: Blob; sha256: string; bytes: number; mime: 'image/png' }
export interface JournalBundle { entry: JournalEntry; capture: ChartCapture; assets: JournalAsset[] }
export interface JournalQuery { instrument?: string; from?: number; to?: number; createdBefore?: number; before?: { time: number; id: string }; text?: string; tag?: string; limit?: number }
export const emptyReasoning = (): JournalReasoning => ({ thesis: '', confirmation: '', invalidation: '', plannedAction: '' });
export function canonicalMarket(series: CanonicalSeries): JournalMarket { return { venue: series.venue, market: series.market, symbol: instrumentOf(series).native }; }
export function marketIdentity(market: JournalMarket) { return JSON.stringify([market.venue, market.market, market.symbol, market.aggregation ?? null]); }
export function marketSeries(market: JournalMarket, interval: unknown) { const series = canonicalSeries({ ...market, interval }); return series && !market.aggregation && instrumentOf(series).native === market.symbol ? series : null; }
export function immutableCopy<T>(value: T): T { const copy = JSON.parse(JSON.stringify(value)); const freeze = (v: any) => { if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } }; freeze(copy); return copy; }
function object(value: unknown): Record<string, any> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid journal record'); return value as Record<string, any>; }
export function utcMs(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1_230_768_000_000 || value > 8_640_000_000_000_000) throw Error('Journal timestamps must be UTC epoch milliseconds'); return value; }
function text(value: unknown, maximum: number = JOURNAL_LIMITS.note): string { if (typeof value !== 'string' || value.length > maximum) throw Error('Invalid or oversized journal text'); return value; }
function id(value: unknown) { const result = text(value, 180); if (!result || /[\u0000-\u001f]/.test(result)) throw Error('Invalid journal identity'); return result; }
function version(value: Record<string, any>) { if (value.version !== 1) throw Error('Unsupported journal schema; original record preserved'); }
export function validateMarket(value: unknown): JournalMarket { const m = object(value); const result: JournalMarket = { venue: id(m.venue), market: id(m.market), symbol: id(m.symbol) }; if (m.aggregation !== undefined) { const a = object(m.aggregation); if (a.version !== 1 || !Array.isArray(a.members) || a.members.length > 32 || JSON.stringify(a).length > 16000) throw Error('Unsupported aggregation definition'); result.aggregation = immutableCopy(a) as JournalMarket['aggregation']; } return result; }
function reasoning(value: unknown): JournalReasoning { const r = object(value); return { thesis: text(r.thesis), confirmation: text(r.confirmation), invalidation: text(r.invalidation), plannedAction: text(r.plannedAction) }; }
function tags(value: unknown): string[] { if (!Array.isArray(value) || value.length > JOURNAL_LIMITS.tags) throw Error('Too many journal tags'); return [...new Set(value.map(v => text(v, 64).trim()).filter(Boolean))]; }
export function validateEntry(value: unknown): JournalEntry {
  const e = object(value); version(e); if (JSON.stringify(e).length > 2 * 1024 * 1024) throw Error('Note history exceeds 2 MB; export this entry and start a follow-up entry'); const market = validateMarket(e.market); if (!['current', 'historical'].includes(e.annotation)) throw Error('Invalid observation annotation');
  if (!Array.isArray(e.revisions) || !e.revisions.length || e.revisions.length > JOURNAL_LIMITS.revisions) throw Error('Invalid note revision history');
  const revisions = e.revisions.map((raw: unknown) => { const r = object(raw); if (!['original', 'edit', 'reflection'].includes(r.kind)) throw Error('Invalid revision kind'); return { at: utcMs(r.at), kind: r.kind, title: text(r.title, 240), note: text(r.note), tags: tags(r.tags), reasoning: reasoning(r.reasoning) }; });
  const result: JournalEntry = { version: 1, id: id(e.id), captureId: id(e.captureId), market, instrument: marketIdentity(market), marketTime: utcMs(e.marketTime), createdAt: utcMs(e.createdAt), capturedAt: utcMs(e.capturedAt), annotation: e.annotation === 'historical' ? 'historical' : 'current', updatedAt: utcMs(e.updatedAt), title: text(e.title, 240), note: text(e.note), tags: tags(e.tags), reasoning: reasoning(e.reasoning), revisions };
  if (result.updatedAt < result.createdAt || revisions[0].kind !== 'original' || revisions[0].at !== result.createdAt || revisions.some((r: NoteRevision, i: number) => r.at < result.createdAt || r.at > result.updatedAt || i && r.at < revisions[i - 1].at)) throw Error('Inconsistent journal timestamps');
  return immutableCopy(result);
}
export function validateCapture(value: unknown): ChartCapture {
  assertSafeJson(value);
  const c = object(value); version(c); const s = object(c.snapshot); version(s); const replay = object(c.replay); version(replay);
  utcMs(c.capturedAt); if (s.capturedAt !== c.capturedAt || JSON.stringify(s).length > JOURNAL_LIMITS.snapshotBytes) throw Error('Invalid chart snapshot');
  const market = validateMarket(s.market); if (marketIdentity(validateMarket(replay.market)) !== marketIdentity(market) || replay.playback !== 'not-implemented' || replay.retention !== 'unpreserved' || replay.chartState !== true) throw Error('Unsupported replay claim');
  for (const key of ['config', 'nativeState', 'drawings', 'objectTree']) object(s[key]);
  if (!s.config || !['candle', 'footprint'].includes(s.config.type) || !Array.isArray(s.config.indicators) || s.config.indicators.length > 24) throw Error('Unsupported chart presentation');
  if (s.dataAsOf !== null) utcMs(s.dataAsOf);
  if (s.visibleRange !== null && (!s.visibleRange || utcMs(s.visibleRange.from) > utcMs(s.visibleRange.to))) throw Error('Invalid snapshot time range');
  if (!Array.isArray(s.panes) || s.panes.length > 32 || !Array.isArray(s.layers) || s.layers.length > 64 || !Array.isArray(s.scripts) || s.scripts.length > 24 || !Array.isArray(s.warnings)) throw Error('Invalid snapshot collections');
  const paneIds = new Set<string>();
  for (const pane of s.panes) { id(pane.id); if (paneIds.has(pane.id) || !Number.isInteger(pane.capturedIndex) || pane.capturedIndex < 0 || pane.capturedIndex >= 32 || !Array.isArray(pane.members) || pane.members.length > 24 || typeof pane.primary !== 'boolean') throw Error('Invalid stable pane reference'); paneIds.add(pane.id); pane.members.forEach(id); }
  for (const layer of s.layers) { id(layer.layer); id(layer.source); for (const key of ['dataAsOf', 'from', 'to']) if (layer[key] !== null) utcMs(layer[key]); if (!Array.isArray(layer.gaps) || layer.gaps.length > 1024) throw Error('Invalid layer gaps'); for (const gap of layer.gaps) if (utcMs(gap.from) >= utcMs(gap.to)) throw Error('Invalid layer gap'); }
  for (const script of s.scripts) { id(script.instanceId); id(script.scriptId); id(script.revisionId); if (script.contentHash !== null && !/^[a-f0-9]{64}$/i.test(script.contentHash)) throw Error('Invalid script content hash'); if (script.source !== undefined && (typeof script.source !== 'string' || script.source.length > 150000 || credentialSource(script.source))) throw Error('Unsafe archived script source'); }
  if (!['complete', 'partial', 'note-only'].includes(c.imageStatus) || !Array.isArray(c.imageWarnings)) throw Error('Invalid capture completeness');
  if (c.imageStatus === 'note-only' ? c.image !== null || c.thumbnail !== null : typeof c.image !== 'string' || typeof c.thumbnail !== 'string') throw Error('Missing capture assets');
  if (replay.captureCutoff !== s.dataAsOf || JSON.stringify(replay.requestedRange) !== JSON.stringify(s.visibleRange) || JSON.stringify(replay.streams) !== JSON.stringify(s.layers) || replay.warmup !== 'unknown') throw Error('Replay metadata must describe the captured evidence');
  if (replay.warmupRequirements !== undefined && (!Array.isArray(replay.warmupRequirements) || replay.warmupRequirements.length > 24 || replay.warmupRequirements.some((r: any) => typeof r.instanceId !== 'string' || !Number.isInteger(r.bars) || r.bars < 1 || r.bars > 100000))) throw Error('Invalid warm-up requirements');
  text(s.app, 160); text(s.engine, 160); s.warnings.forEach((warning: unknown) => text(warning, 1000));
  if (c.imageStatus === 'complete' && c.imageWarnings.length) throw Error('Partial screenshot cannot claim completeness');
  if (replay.screenshot !== Boolean(c.image)) throw Error('Inconsistent screenshot claim');
  return immutableCopy({ version: 1, id: id(c.id), capturedAt: c.capturedAt, snapshot: s as ChartSnapshot, replay: replay as ReplayManifest, image: c.image === null ? null : id(c.image), thumbnail: c.thumbnail === null ? null : id(c.thumbnail), imageStatus: c.imageStatus, imageWarnings: c.imageWarnings.map((v: unknown) => text(v, 500)) });
}
export function createEntry(capture: ChartCapture, marketTime: number, now = capture.capturedAt, annotation: 'current' | 'historical' = 'current'): JournalEntry { const r = { at: now, kind: 'original' as const, title: '', note: '', tags: [], reasoning: emptyReasoning() }; return validateEntry({ version: 1, id: crypto.randomUUID(), captureId: capture.id, market: capture.snapshot.market, marketTime, createdAt: now, capturedAt: capture.capturedAt, annotation, updatedAt: now, ...r, revisions: [r] }); }
export function reviseEntry(entry: JournalEntry, patch: Pick<JournalEntry, 'title' | 'note' | 'tags' | 'reasoning'>, kind: 'edit' | 'reflection' = 'edit', now = Date.now()): JournalEntry { const at = Math.max(now, entry.updatedAt); return validateEntry({ ...entry, ...patch, updatedAt: at, revisions: [...entry.revisions, { ...patch, at, kind }] }); }

const credentialKey = /^(?:api[_-]?key|access[_-]?token|authorization|password|private[_-]?key|mnemonic|seed(?:phrase)?|wallet|secret|sessionToken|cookie)$/i;
export function credentialSource(source: string) { return /(?:api[_-]?key|secret|private[_-]?key|mnemonic|seed[_-]?phrase)\s*[:=]\s*['"`][^'"`]{8,}/i.test(source); }
export function assertSafeJson(value: unknown, depth = 0) { if (depth > 40) throw Error('Journal state is too deeply nested'); if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Non-finite journal number'); if (Array.isArray(value)) { if (value.length > 12000) throw Error('Oversized journal collection'); for (const item of value) assertSafeJson(item, depth + 1); } else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (/^(?:__proto__|prototype|constructor)$/.test(key) || credentialKey.test(key)) throw Error('Credential-like or unsafe state is excluded from the journal'); assertSafeJson(child, depth + 1); } }
export function publicCaptureCopy<T>(value: T): T { const clean = (v: any): any => Array.isArray(v) ? v.map(clean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([key]) => !credentialKey.test(key) && !/^(?:__proto__|prototype|constructor)$/.test(key)).map(([key, child]) => [key, clean(child)])) : v; return immutableCopy(clean(value)); }

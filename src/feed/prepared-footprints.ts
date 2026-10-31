import { historyScheduler } from './history-scheduler';
import { HistoryTileCache, type TileCache } from './history-tile-cache';
import { duration, footprintAnalysisSourceKey, type FootprintAnalysisSummary, type FootprintBar, type Interval, type Market } from './protocol';
import { MAX_FOOTPRINT_ANALYSIS_SUMMARIES, preparedFootprintAnalysisSummary } from '../chart/footprint-delta-flips';

export const footprintFeed = (market: Market) => market === 'spot'
  ? 'binance:spot:BTCUSDT:aggregate-trade' : 'binance:perpetual:BTCUSDT:aggregate-trade';

export interface PreparedFootprintAnalysisBatch {
  from: number;
  to: number;
  summaries: FootprintAnalysisSummary[];
  removedTimes: number[];
}

type PreparedTile = { from: number; revision: number; bar?: FootprintBar | null; coverage?: unknown };
const MAX_SUMMARY_SOURCES = 8;

/** Loads full cells only for the visible range; older warmup is projected per 4h chunk. */
export class PreparedFootprints {
  private summaries = new Map<string, Map<number, FootprintAnalysisSummary>>();

  constructor(private request: typeof fetch = (...args) => fetch(...args), private cache: TileCache = new HistoryTileCache()) {}

  async load(
    from: number,
    to: number,
    interval: Interval,
    rowPrice: number,
    signal: AbortSignal,
    publish: (bars: FootprintBar[], complete: boolean, validated: boolean, analysis?: PreparedFootprintAnalysisBatch) => void,
    market: Market = 'perpetual',
    analysisFrom = from,
  ) {
    const step = duration[interval];
    const feed = footprintFeed(market);
    const sourceKey = footprintAnalysisSourceKey(market, interval);
    const summaryKey = `${sourceKey}:p${Math.round(rowPrice * 10)}`;
    const tileKey = (start: number) => `footprint:${feed}:1:${step}:${Math.round(rowPrice * 10)}:${start}`;
    const visibleFrom = Math.floor(from / step) * step;
    const visibleTo = Math.ceil(to / step) * step;
    const summaryFrom = Math.floor(Math.min(analysisFrom, visibleFrom) / step) * step;
    const visibleStarts = startsBetween(visibleFrom, visibleTo, step);
    const analysisStarts = startsBetween(summaryFrom, visibleTo, step);
    const saved = await this.cache.getMany(visibleStarts.map(tileKey));
    const visibleTiles = new Map<number, PreparedTile>();
    for (const start of visibleStarts) {
      const tile = saved.get(tileKey(start)) as PreparedTile | undefined;
      if (tile && validTileIdentity(tile, start)) visibleTiles.set(start, tile);
    }

    const validatedTimes = new Set<number>();
    const removedTimes = new Set<number>();
    const cacheSummaries = this.summaryMap(summaryKey);
    for (const [start, tile] of visibleTiles) {
      if (tile.bar) {
        const summary = summaryForTile(tile, sourceKey, interval, false, market);
        if (summary) cacheSummaries.set(start / 1000, summary);
      }
    }
    this.trimSummaries(summaryKey, summaryFrom, visibleTo);
    if (!signal.aborted && (visibleTiles.size || cacheSummaries.size)) {
      publish(this.visibleBars(visibleTiles), false, false, this.analysisBatch(summaryKey, summaryFrom, visibleTo, validatedTimes, removedTimes));
    }

    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      let visiblePending = false, analysisPending = false, analysisFailed = false;
      const chunks = [...chunkRange(visibleFrom, visibleTo, 0, step), ...chunkRange(summaryFrom, visibleFrom, 1, step)];
      for (const { from: start, to: end, priority } of chunks) {
        const chunkStarts = analysisStarts.filter(at => at >= start && at < end);
        const known = chunkStarts.flatMap(at => {
          const visible = visibleTiles.get(at);
          if (visible && visible.bar && validTileCoverage(visible.coverage, at, at + step)) return [`${at}:${visible.revision}`];
          const summary = cacheSummaries.get(at / 1000);
          return summary?.revisionSource === 'prepared-content-hash' && summary.coverageEvidence.validated
            ? [`${at}:${summary.revision}`] : [];
        }).join(',');
        const params = new URLSearchParams({ from: String(start), to: String(end), interval, rowPrice: String(rowPrice), known });
        if (market === 'spot') params.set('market', 'spot');
        const url = `/market-data/v2/history/footprints?${params}`;
        let data: any;
        try {
          data = await historyScheduler.read(url, 'footprint', signal, async shared => {
            const response = await this.request(url, { signal: AbortSignal.any([shared, AbortSignal.timeout(30_000)]) });
            const payload = await response.json();
            if (!response.ok) throw Error(payload.error ?? `Footprint history HTTP ${response.status}`);
            return payload;
          }, priority);
        } catch (error) {
          if (signal.aborted) throw error;
          if (priority === 1) { analysisFailed = true; break; }
          throw error;
        }
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (data.state === 'unavailable' || data.version !== 1 || data.feed !== feed || !Array.isArray(data.tiles) || data.tiles.length > 300) {
          if (priority === 1) { analysisFailed = true; break; }
          if (data.state === 'unavailable') throw Error('Historical footprint build unavailable; inspect staging materializer backlog');
          throw Error('Invalid prepared footprints');
        }

        const updates: Array<{ key: string; value: PreparedTile }> = [];
        for (const raw of data.tiles as PreparedTile[]) {
          if (!validTileIdentity(raw) || raw.from < start || raw.from >= end || raw.from % step) throw Error('Invalid footprint tile identity');
          const oldSummary = cacheSummaries.get(raw.from / 1000);
          const oldVisible = visibleTiles.get(raw.from);
          if (Object.hasOwn(raw, 'bar')) {
            if (raw.bar === null) {
              cacheSummaries.delete(raw.from / 1000); removedTimes.add(raw.from / 1000); validatedTimes.add(raw.from / 1000);
              if (raw.from >= visibleFrom && raw.from < visibleTo) {
                const tile = { ...raw, coverage: raw.coverage };
                visibleTiles.set(raw.from, tile); updates.push({ key: tileKey(raw.from), value: tile });
              }
              continue;
            }
            const tile = { ...raw, bar: { ...raw.bar!, revision: raw.revision } };
            const summary = summaryForTile(tile, sourceKey, interval, true, market);
            if (summary) cacheSummaries.set(raw.from / 1000, summary);
            else cacheSummaries.delete(raw.from / 1000);
            removedTimes.delete(raw.from / 1000);
            if (raw.from >= visibleFrom && raw.from < visibleTo) {
              visibleTiles.set(raw.from, tile); updates.push({ key: tileKey(raw.from), value: tile });
            }
            validatedTimes.add(raw.from / 1000);
          } else {
            const old = oldSummary?.revision === raw.revision ? oldSummary
              : oldVisible?.revision === raw.revision && oldVisible.bar ? summaryForTile(oldVisible, sourceKey, interval, true, market) : undefined;
            if (!old) throw Error('Missing validated footprint tile');
            if (raw.coverage === undefined && old.revisionSource === 'unknown') throw Error('Missing validated footprint coverage');
            const summary = raw.coverage !== undefined
              ? refreshSummaryCoverage(old, raw.coverage, sourceKey, interval)
              : { ...old, coverageEvidence: { ...old.coverageEvidence, validated: true } };
            cacheSummaries.set(raw.from / 1000, summary);
            removedTimes.delete(raw.from / 1000);
            if (oldVisible && oldVisible.revision === raw.revision) {
              visibleTiles.set(raw.from, { ...oldVisible, coverage: raw.coverage ?? oldVisible.coverage });
            }
            validatedTimes.add(raw.from / 1000);
          }
        }
        await this.cache.putMany(updates);
        this.trimSummaries(summaryKey, summaryFrom, visibleTo);
        if (priority === 0) visiblePending ||= data.state === 'building';
        else analysisPending ||= data.state === 'building';
        if (!signal.aborted) publish(this.visibleBars(visibleTiles), !visiblePending, true,
          this.analysisBatch(summaryKey, summaryFrom, visibleTo, validatedTimes, removedTimes));
      }

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!signal.aborted) publish(this.visibleBars(visibleTiles), !visiblePending, true,
        this.analysisBatch(summaryKey, summaryFrom, visibleTo, validatedTimes, removedTimes));
      // Strength warmup is optional. A failed or still-building older chunk
      // leaves the visible tiles ready and lets the strength show unavailable.
      if (analysisFailed || analysisPending || !visiblePending) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, 1000);
        function done() { signal.removeEventListener('abort', cancel); resolve(); }
        function cancel() { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new DOMException('Aborted', 'AbortError')); }
        signal.addEventListener('abort', cancel, { once: true });
      });
    }
  }

  private summaryMap(key: string) {
    let value = this.summaries.get(key);
    if (!value) { value = new Map(); this.summaries.set(key, value); }
    this.summaries.delete(key); this.summaries.set(key, value);
    while (this.summaries.size > MAX_SUMMARY_SOURCES) this.summaries.delete(this.summaries.keys().next().value!);
    return value;
  }

  private trimSummaries(key: string, protectFrom: number, protectTo: number) {
    const map = this.summaries.get(key);
    if (!map) return;
    const outside = [...map.keys()].filter(time => time * 1000 < protectFrom || time * 1000 >= protectTo).sort((a, b) => a - b);
    while (map.size > MAX_FOOTPRINT_ANALYSIS_SUMMARIES && outside.length) map.delete(outside.shift()!);
    while (map.size > MAX_FOOTPRINT_ANALYSIS_SUMMARIES) map.delete(Math.min(...map.keys()));
  }

  private visibleBars(tiles: ReadonlyMap<number, PreparedTile>) {
    return [...tiles].sort(([a], [b]) => a - b).flatMap(([, tile]) => tile.bar ? [tile.bar] : []);
  }

  private analysisBatch(key: string, from: number, to: number, validated: ReadonlySet<number>, removed: ReadonlySet<number>): PreparedFootprintAnalysisBatch {
    const summaries = this.summaries.get(key);
    return { from, to,
      summaries: summaries ? [...summaries.values()].filter(item => item.time * 1000 >= from && item.time * 1000 < to)
        .map(item => validated.has(item.time) ? item : { ...item, coverageEvidence: { ...item.coverageEvidence, validated: false } }) : [],
      removedTimes: [...removed].filter(time => time * 1000 >= from && time * 1000 < to) };
  }

  dispose() { this.summaries.clear(); this.cache.dispose?.(); }
}

function startsBetween(from: number, to: number, step: number) {
  const starts: number[] = [];
  for (let time = from; time < to; time += step) starts.push(time);
  return starts;
}

function chunkRange(from: number, to: number, priority: number, step: number) {
  const chunks: Array<{ from: number; to: number; priority: number }> = [];
  // The prepared-history endpoint caps every footprint request at four hours.
  // A 5m lookback still takes multiple lower-priority requests (50 bars alone
  // exceed that cap); never widen a page to fit an arbitrary candle count.
  const span = 14_400_000;
  for (let start = from; start < to; start += span) chunks.push({ from: start, to: Math.min(to, start + span), priority });
  return chunks;
}

function validTileIdentity(tile: PreparedTile, expectedFrom?: number): boolean {
  return !!tile && Number.isSafeInteger(tile.from) && (expectedFrom === undefined || tile.from === expectedFrom)
    && Number.isSafeInteger(tile.revision) && tile.revision >= 0;
}

function validTileCoverage(value: unknown, from: number, to: number): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const coverage = value as Record<string, unknown>;
  if (coverage.from !== from || coverage.to !== to || typeof coverage.complete !== 'boolean' || !Array.isArray(coverage.gaps) || coverage.gaps.length > 512) return false;
  return coverage.gaps.every((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const gap = raw as Record<string, unknown>;
    return Number.isSafeInteger(gap.from) && Number.isSafeInteger(gap.to) && (gap.from as number) >= from
      && (gap.to as number) <= to && (gap.to as number) > (gap.from as number)
      && typeof gap.reason === 'string' && gap.reason.length <= 1000;
  });
}

function summaryForTile(tile: PreparedTile, sourceKey: string, interval: Interval, validated: boolean, market: Market) {
  const bar = tile.bar;
  const expectedSource = market === 'spot' ? 'binance-spot-aggtrade' : 'binance-usdm-aggtrade';
  if (!bar || tile.from !== bar.time * 1000 || !Number.isSafeInteger(bar.time) || !Number.isFinite(bar.delta)
    || bar.source !== expectedSource || bar.granularity !== 'aggregate-trade'
    || !['partial', 'observed', 'gapped', 'capacity-limited'].includes(bar.coverage) || typeof bar.gapBefore !== 'boolean') return undefined;
  return preparedFootprintAnalysisSummary({ ...bar, revision: tile.revision } as FootprintBar, tile.coverage, sourceKey, interval, validated);
}

function refreshSummaryCoverage(summary: FootprintAnalysisSummary, coverage: unknown, sourceKey: string, interval: Interval) {
  const pseudoBar = { time: summary.time, revision: summary.revision, delta: summary.delta, quoteDelta: summary.quoteDelta,
    coverage: summary.coverage === 'unknown' ? 'partial' : summary.coverage, gapBefore: summary.gapBefore } as FootprintBar;
  return preparedFootprintAnalysisSummary(pseudoBar, coverage, sourceKey, interval, true);
}

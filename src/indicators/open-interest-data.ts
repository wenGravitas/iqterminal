import { duration, instrumentOf, marketOf, type Candle, type Series } from '../feed/protocol';
import type { FeedClient } from '../feed/client';
import {
  RAW_OPEN_INTEREST_MAX_AGE_MS,
  RAW_OPEN_INTEREST_MAX_RANGE_MS,
  RAW_OPEN_INTEREST_VENUES,
  RawOpenInterestHistory,
  compatibleRawOpenInterestVenues,
  type RawOpenInterestEvent,
  type RawOpenInterestFeedStatus,
  type RawOpenInterestObservation,
  type RawOpenInterestPayload,
  type RawOpenInterestVenue,
} from '../feed/raw-open-interest';
import { numericOutputContextId, numericOutputId, numericOutputSchemaId } from '../scripts/composition';
import type { ChartNumericOutput, ChartNumericOutputRegistry, NumericResetSegment } from '../scripts/output-registry';

export const OPEN_INTEREST_ID = 'native.raw-open-interest';
export const OPEN_INTEREST_TOTAL_KEY = 'openInterestTotalBtc';
export type OpenInterestSettings = { venues: RawOpenInterestVenue[]; hidden: string[]; paneWeight: number };
export interface OpenInterestPoint {
  time: number;
  value: number | null;
  sourceTimeMs: number | null;
  observedAtMs: number | null;
  ageMs: number | null;
  epoch: number | null;
  unit: string | null;
  quality: 'complete' | 'partial' | 'stale' | 'unavailable';
  reset: boolean;
  source: string | null;
  sourceTimeQuality: string | null;
}
export interface OpenInterestLine { id: string; name: string; points: OpenInterestPoint[] }
export interface OpenInterestFrame {
  lines: Map<string, OpenInterestLine>;
  quality: 'complete' | 'partial' | 'stale' | 'unavailable';
  truncated: boolean;
  feeds: Partial<Record<RawOpenInterestVenue, RawOpenInterestFeedStatus>>;
  asOfMs: number;
  history: string;
}
interface Projection { plotKey: string; title: string; unit: 'BTC'; sourceScope: string; values: (number | null)[]; resets: NumericResetSegment[]; quality: ChartNumericOutput['quality']; available: boolean }

export function openInterestSettings(value: unknown): OpenInterestSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const venues = compatibleRawOpenInterestVenues(raw.venues);
  const hidden = Array.isArray(raw.hidden) ? [...new Set(raw.hidden.filter((value): value is string => typeof value === 'string' && value.length <= 80))].slice(0, 8) : [];
  const paneWeight = typeof raw.paneWeight === 'number' && Number.isFinite(raw.paneWeight) ? Math.max(.08, Math.min(3, raw.paneWeight)) : .28;
  return { venues: venues.length ? venues : [...RAW_OPEN_INTEREST_VENUES], hidden, paneWeight };
}

/** Project as-of source states onto the host candle timeline without interpolation or synthetic bars. */
export function projectOpenInterest(history: RawOpenInterestHistory, payload: RawOpenInterestPayload | undefined,
  venues: readonly RawOpenInterestVenue[], times: readonly number[], intervalMs: number, now: number) {
  const lines = new Map<string, OpenInterestLine>(), selected = compatibleRawOpenInterestVenues(venues);
  const payloadFrom = Math.max(1, now - RAW_OPEN_INTEREST_MAX_RANGE_MS);
  const rows = history.observations(selected, payloadFrom, now);
  const perVenue = new Map<RawOpenInterestVenue, OpenInterestPoint[]>();
  let anyStale = false, anyPartial = Boolean(payload?.truncated || payload?.invalidRows), anyAvailable = false;
  const feeds = payload?.feeds ?? {};
  for (const venue of selected) {
    const samples = rows.filter(row => row.venue === venue);
    const verification = payload?.unitVerification[venue];
    const points: OpenInterestPoint[] = [];
    let sampleIndex = 0, previousKey = '', previousSample: RawOpenInterestObservation | undefined;
    let lastConsumedSample: RawOpenInterestObservation | undefined, sawUsableSample = false;
    for (let index = 0; index < times.length; index++) {
      const time = times[index]!, intervalEnd = time + intervalMs;
      const asOf = Math.min(now, intervalEnd - 1);
      let sourceReset = false;
      while (sampleIndex < samples.length && samples[sampleIndex]!.sourceTimeMs <= asOf) {
        const observed = samples[sampleIndex++]!;
        sourceReset ||= observed.gapBefore || Boolean(lastConsumedSample && (observed.epoch !== lastConsumedSample.epoch
          || observed.sourceTimeMs - lastConsumedSample.sourceTimeMs > RAW_OPEN_INTEREST_MAX_AGE_MS));
        lastConsumedSample = observed;
      }
      const sample = sampleIndex ? samples[sampleIndex - 1] : undefined;
      const ageMs = sample ? Math.max(0, asOf - sample.sourceTimeMs) : null;
      const verified = verification?.status === 'verified' && verification.units === 'BTC';
      const currentKey = sample ? `${sample.epoch}:${sample.sourceTimeMs}` : '';
      const changedSample = Boolean(sample && currentKey !== previousKey);
      const usable = Boolean(sample && sample.units === 'BTC' && verified && sample.quality === 'valid'
        && ageMs !== null && ageMs <= RAW_OPEN_INTEREST_MAX_AGE_MS && sample.sourceTimeMs <= now);
      const historyReset = Boolean(usable && !sawUsableSample && (payload?.truncated || (payload?.invalidRows ?? 0) > 0));
      const reset = Boolean(sourceReset || historyReset || sample && changedSample && (sample.gapBefore || previousSample && (previousSample.epoch !== sample.epoch
        || sample.sourceTimeMs - previousSample.sourceTimeMs > RAW_OPEN_INTEREST_MAX_AGE_MS)));
      const stale = Boolean(sample && ageMs !== null && ageMs > RAW_OPEN_INTEREST_MAX_AGE_MS);
      const quality: OpenInterestPoint['quality'] = usable ? (reset || payload?.truncated ? 'partial' : 'complete')
        : stale ? 'stale' : sample && (!verified || sample.units !== 'BTC' || sample.quality !== 'valid') ? 'partial' : 'unavailable';
      points.push({ time, value: usable ? sample!.value : null, sourceTimeMs: sample?.sourceTimeMs ?? null,
        observedAtMs: sample?.observedAtMs ?? null, ageMs, epoch: sample?.epoch ?? null, unit: sample?.units ?? null,
        quality, reset, source: sample?.source ?? null, sourceTimeQuality: sample?.sourceTimeQuality ?? null });
      if (usable) { anyAvailable = true; anyPartial ||= reset || Boolean(payload?.truncated || payload?.invalidRows); sawUsableSample = true; }
      else { anyPartial = true; if (stale) anyStale = true; }
      if (changedSample && sample) { previousKey = currentKey; previousSample = sample; }
    }
    perVenue.set(venue, points);
    lines.set(venue, { id: venue, name: venueLabel(venue), points });
  }
  const totalPoints: OpenInterestPoint[] = [];
  const resets: NumericResetSegment[] = [];
  let previousPartial = false, firstHistoryReset = false;
  for (let index = 0; index < times.length; index++) {
    const points = selected.map(venue => perVenue.get(venue)![index]!);
    const used = points.filter(point => point.value !== null && point.unit === 'BTC');
    const missing = used.length !== selected.length;
    const value = used.length ? used.reduce((sum, point) => sum + point.value!, 0) : null;
    const reset = points.some(point => point.reset);
    const partial = missing || points.some(point => point.quality === 'partial') || Boolean(payload?.truncated || payload?.invalidRows);
    const point: OpenInterestPoint = { time: times[index]!, value, sourceTimeMs: maxNullable(used.map(p => p.sourceTimeMs)),
      observedAtMs: maxNullable(used.map(p => p.observedAtMs)), ageMs: maxNullable(used.map(p => p.ageMs)),
      epoch: null, unit: used.length ? 'BTC' : null,
      quality: value === null ? points.some(p => p.quality === 'stale') ? 'stale' : 'unavailable' : partial ? 'partial' : 'complete',
      reset, source: used.length ? 'verified perpetual venues' : null,
      sourceTimeQuality: used.some(p => p.sourceTimeQuality === 'collector-sampled') ? 'collector-sampled' : used.length ? 'exchange-event' : null };
    totalPoints.push(point);
    if (reset) pushReset(resets, point.time, 'Open interest source epoch or observation gap');
    if ((payload?.truncated || (payload?.invalidRows ?? 0) > 0) && !firstHistoryReset && value !== null) {
      pushReset(resets, point.time, payload?.truncated ? 'Raw open-interest history was truncated' : 'Invalid raw open-interest rows were omitted');
      firstHistoryReset = true;
    }
    if (partial && !previousPartial && value !== null) pushReset(resets, point.time, 'Partial or interrupted venue coverage');
    previousPartial = partial;
  }
  lines.set('total', { id: 'total', name: 'Total · selected verified venues', points: totalPoints });
  const quality = !anyAvailable ? anyStale ? 'stale' : 'unavailable' : anyPartial ? 'partial' : 'complete';
  return { lines, quality, truncated: Boolean(payload?.truncated), feeds, asOfMs: payload?.asOfMs ?? now,
    history: payload?.history ?? 'Waiting for persisted raw open-interest observations.' } satisfies OpenInterestFrame;
}

/** Data ownership and scalar outputs live independently of the optional pane view. */
export class OpenInterestDataController {
  readonly history = new RawOpenInterestHistory();
  private settings: OpenInterestSettings;
  private series: Series;
  private hostCandles: readonly Candle[] = [];
  private hostTimes: number[] = [];
  private hostKey = '';
  private contextId: string;
  private contextRevision = 0;
  private release?: () => void;
  private listeners = new Set<(event: RawOpenInterestEvent) => void>();
  private dataDemand = false;
  private hostVisible = true;
  private generation = 0;
  private subscribed = false;
  private payload?: RawOpenInterestPayload;
  private feedError = '';
  private publishedIds = new Set<string>();
  private dataRevision = 0;
  private outputPublications = 0;
  private subscriptionStarts = 0;
  private subscriptionStops = 0;
  private dead = false;
  private frameCache?: OpenInterestFrame;
  private readonly visibilityListener = () => this.syncSubscription();

  constructor(private readonly chartId: string, private readonly instanceId: string, private readonly feed: FeedClient,
    private readonly registry: ChartNumericOutputRegistry, settings: unknown, series: Series, private readonly now = Date.now) {
    this.settings = openInterestSettings(settings); this.series = series; this.contextId = numericOutputContextId(series);
    document.addEventListener('visibilitychange', this.visibilityListener);
    this.publishOutputs(true);
  }

  configure(value: unknown, series: Series) {
    if (this.dead) return;
    const nextSettings = openInterestSettings(value), nextContext = numericOutputContextId(series);
    const previousSeries = this.series;
    const settingsChanged = JSON.stringify(this.settings) !== JSON.stringify(nextSettings), contextChanged = this.contextId !== nextContext;
    const selectionChanged = JSON.stringify(previousSeries) !== JSON.stringify(series);
    const intervalChanged = previousSeries.interval !== series.interval;
    const venuesChanged = this.settings.venues.length !== nextSettings.venues.length
      || this.settings.venues.some((venue, index) => venue !== nextSettings.venues[index]);
    if (!settingsChanged && !selectionChanged) return;
    this.settings = nextSettings; this.series = series;
    if (contextChanged) {
      this.contextId = nextContext; this.contextRevision++;
      const canRetainPerpetualHistory = marketOf(previousSeries) === 'perpetual' && marketOf(series) === 'perpetual'
        && instrumentOf(previousSeries).base === 'BTC' && instrumentOf(series).base === 'BTC';
      if (!canRetainPerpetualHistory) { this.history.clear(); this.payload = undefined; }
      this.frameCache = undefined; this.hostKey = '';
    } else if (venuesChanged || intervalChanged) { this.contextRevision++; this.frameCache = undefined; }
    if (intervalChanged) { this.hostKey = ''; this.hostTimes = []; }
    // The panel supplies the new timeframe's candle timeline immediately after
    // configure. Publish from that timeline in setHostCandles; the raw OI feed
    // itself is timeframe-independent and remains subscribed.
    if ((contextChanged || venuesChanged) && !intervalChanged) this.publishOutputs(true);
    this.syncSubscription();
  }

  setHostCandles(candles: readonly Candle[]) {
    if (this.dead) return;
    const last = candles.at(-1), first = candles[0];
    const key = `${candles.length}:${first?.t ?? ''}:${last?.t ?? ''}:${last?.closed ?? ''}:${this.contextId}:${this.series.interval}`;
    // This is the hot path: panel candle patches mutate the forming OHLCV
    // object in place. Return before slicing/copying the 5,000-bar timeline.
    if (candles === this.hostCandles && key === this.hostKey) return;
    const previousLength = this.hostCandles.length, previousCandles = this.hostCandles.slice(-5_000);
    const nextCandles = candles.slice(-5_000), nextTimes = nextCandles.map(candle => candle.t);
    const timesChanged = nextTimes.length !== this.hostTimes.length || nextTimes.some((time, index) => time !== this.hostTimes[index]);
    const closedChanged = previousCandles.length !== nextCandles.length
      || nextCandles.some((candle, index) => previousCandles[index]?.t === candle.t
        && previousCandles[index]?.closed !== candle.closed);
    if (key === this.hostKey && !timesChanged && !closedChanged) {
      // Snapshots may replace the array while retaining the same candle grid.
      this.hostCandles = candles;
      return;
    }
    this.hostCandles = candles; this.hostTimes = nextTimes; this.hostKey = key; this.frameCache = undefined;
    this.publishOutputs(previousLength !== candles.length || !previousLength || timesChanged || closedChanged);
  }

  setDataDemand(demanded: boolean) { if (this.dead || this.dataDemand === demanded) return; this.dataDemand = demanded; this.syncSubscription(); }
  setHostVisible(visible: boolean) { if (this.dead || this.hostVisible === visible) return; this.hostVisible = visible; this.syncSubscription(); }
  subscribe(listener: (event: RawOpenInterestEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  settingsSnapshot() { return { ...this.settings, venues: [...this.settings.venues], hidden: [...this.settings.hidden] }; }
  readoutAt(time: number) {
    const frame = this.viewFrame();
    return { frame, lines: [...frame.lines.values()].map(line => {
      const point = pointAtTime(line.points, time);
      return { id: line.id, name: line.name, value: point?.value ?? null, ageMs: point?.ageMs ?? null,
        quality: point?.quality ?? 'unavailable', sourceTimeMs: point?.sourceTimeMs ?? null,
        hidden: this.settings.hidden.includes(line.id), unit: point?.unit ?? 'BTC' };
    }) };
  }
  viewFrame() { return this.frameCache ?? this.buildFrame(); }

  diagnostics() {
    return { demanded: this.dataDemand, hostVisible: this.hostVisible, subscribed: this.subscribed, feedError: this.feedError,
      retainedObservations: this.history.diagnostics().retained, contextRevision: this.contextRevision, dataRevision: this.dataRevision,
      outputPublications: this.outputPublications, subscriptionStarts: this.subscriptionStarts, subscriptionStops: this.subscriptionStops,
      outputRevisions: Object.fromEntries([...this.publishedIds].map(id => [id, this.registry.get(id)?.revision ?? 0])) };
  }

  dispose() {
    if (this.dead) return; this.dead = true; document.removeEventListener('visibilitychange', this.visibilityListener);
    this.release?.(); this.release = undefined; this.listeners.clear(); this.registry.releaseOwner(this.instanceId, 'Open Interest was removed.'); this.history.clear(); this.frameCache = undefined;
  }

  private syncSubscription() {
    const supported = marketOf(this.series) === 'perpetual';
    const desired = this.dataDemand && this.hostVisible && !document.hidden && supported;
    if (desired === this.subscribed) return;
    if (this.release) { this.subscriptionStops++; this.release(); }
    this.release = undefined; this.subscribed = desired; const generation = ++this.generation;
    if (!desired) { this.feedError = ''; this.registry.markUnavailable(this.instanceId, 'Open Interest data demand is paused.'); this.frameCache = undefined; return; }
    this.subscriptionStarts++;
    this.release = this.feed.subscribeRawOpenInterest(`raw-open-interest:${this.chartId}:${this.instanceId}`, { venues: [...RAW_OPEN_INTEREST_VENUES] }, event => {
      if (this.dead || generation !== this.generation) return;
      this.receive(event);
    });
  }

  private receive(event: RawOpenInterestEvent) {
    if (event.type === 'raw-open-interest-error') { this.feedError = event.message; this.dataRevision++; this.registry.markUnavailable(this.instanceId, event.message, 'stale'); this.frameCache = undefined; this.notify(event); return; }
    this.feedError = '';
    if (event.type === 'raw-open-interest-snapshot') this.history.clear();
    this.history.merge({ ...event.payload, observations: event.payload.observations });
    this.payload = { ...event.payload, observations: this.history.observations(RAW_OPEN_INTEREST_VENUES, event.payload.from, event.payload.to) };
    this.frameCache = undefined; this.dataRevision++;
    this.publishOutputs(event.type === 'raw-open-interest-snapshot'); this.notify(event);
  }

  private notify(event: RawOpenInterestEvent) { for (const listener of [...this.listeners]) listener(event); }

  private buildFrame(): OpenInterestFrame {
    const frame = projectOpenInterest(this.history, this.payload, this.settings.venues, this.hostTimes, duration[this.series.interval], this.now());
    if (this.feedError) frame.quality = 'stale';
    this.frameCache = frame; return frame;
  }

  private publishOutputs(full: boolean) {
    if (this.dead) return;
    const frame = this.buildFrame(), outputs: ChartNumericOutput[] = [];
    for (const venue of this.settings.venues) {
      const line = frame.lines.get(venue); if (!line) continue;
      outputs.push(this.toOutput(venueOutputKey(venue), line.name, `open-interest:venue:${venue}`, line.points.map(point => point.value), line.points, full));
    }
    const total = frame.lines.get('total');
    if (total) outputs.push(this.toOutput(OPEN_INTEREST_TOTAL_KEY, total.name, 'open-interest:verified-perpetual-btc-venues', total.points.map(point => point.value), total.points, full));
    const nextIds = new Set(outputs.map(output => output.outputId));
    for (const outputId of this.publishedIds) if (!nextIds.has(outputId)) this.registry.releaseOutput(this.instanceId, outputId, 'The selected Open Interest venue was removed.');
    const changed = outputs.filter(output => !samePublishedOutput(this.registry.get(output.outputId), output));
    try {
      if (changed.length) { this.registry.publishMany(changed); this.outputPublications++; }
      this.publishedIds = nextIds;
    } catch (error) { this.registry.markUnavailable(this.instanceId, `Open Interest output publication failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private toOutput(plotKey: string, title: string, sourceScope: string, values: (number | null)[], points: OpenInterestPoint[], full: boolean): ChartNumericOutput {
    const outputId = numericOutputId(this.instanceId, plotKey), previous = this.registry.get(outputId);
    const resets: NumericResetSegment[] = [];
    for (const point of points) if (point.reset) pushReset(resets, point.time, 'Open Interest source epoch or observation gap');
    const firstAvailablePoint = points.find(point => point.value !== null);
    if (firstAvailablePoint && this.payload?.truncated) pushReset(resets, firstAvailablePoint.time, 'Raw open-interest history was truncated');
    if (firstAvailablePoint && (this.payload?.invalidRows ?? 0) > 0) pushReset(resets, firstAvailablePoint.time, 'Invalid raw open-interest rows were omitted');
    const available = values.some(value => value !== null);
    const quality = frameQuality(points);
    const timesChanged = Boolean(previous && (previous.times.length !== this.hostTimes.length || this.hostTimes.some((time, index) => previous.times[index] !== time)));
    const changedRange = { from: full || !previous || timesChanged || previous.values.length !== values.length ? 0 : firstChangedIndex(previous.values, values), to: values.length };
    return { kind: 'indicator-output', version: 1, instanceId: this.instanceId, outputId, plotKey,
      schemaId: numericOutputSchemaId(plotKey, 'BTC'), domain: 'chart-candles-v1', contextId: this.contextId, unit: 'BTC', title,
      revision: (previous?.revision ?? 0) + 1, contextRevision: this.contextRevision, available,
      times: this.hostTimes, values, quantity: 'level', marketScope: this.contextId, sourceScope,
      timestampConvention: 'candle-open', quality, resets, changedRange };
  }
}

export function openInterestNumericPlotKey(id: 'total' | RawOpenInterestVenue) { return id === 'total' ? OPEN_INTEREST_TOTAL_KEY : venueOutputKey(id); }
export function openInterestVenueLabel(venue: RawOpenInterestVenue) { return venueLabel(venue); }

function venueOutputKey(venue: RawOpenInterestVenue) {
  return venue === 'binance' ? 'openInterestBinancePerpetualBtc' : venue === 'hyperliquid' ? 'openInterestHyperliquidPerpetualBtc' : 'openInterestBybitPerpetualBtc';
}
function venueLabel(venue: RawOpenInterestVenue) { return venue === 'binance' ? 'Binance USD-M Perp' : venue === 'hyperliquid' ? 'Hyperliquid Perp' : 'Bybit Perp'; }
function maxNullable(values: (number | null)[]) { const usable = values.filter((value): value is number => value !== null); return usable.length ? Math.max(...usable) : null; }
function pushReset(resets: NumericResetSegment[], fromTime: number, reason: string) { if (!resets.some(reset => reset.fromTime === fromTime)) resets.push({ fromTime, reason }); }
function frameQuality(points: readonly OpenInterestPoint[]): ChartNumericOutput['quality'] {
  const available = points.some(point => point.value !== null);
  if (!available) return points.some(point => point.quality === 'stale') ? 'stale' : 'unavailable';
  return points.some(point => point.quality === 'partial' || point.quality === 'unavailable' || point.quality === 'stale') ? 'partial' : 'complete';
}
function firstChangedIndex(previous: readonly (number | null)[], next: readonly (number | null)[]) {
  for (let index = 0; index < next.length; index++) if (previous[index] !== next[index]) return index;
  return next.length;
}
function pointAtTime(points: readonly OpenInterestPoint[], time: number) {
  let low = 0, high = points.length;
  while (low < high) { const middle = (low + high) >>> 1; if (points[middle]!.time < time) low = middle + 1; else high = middle; }
  if (points[low]?.time === time) return points[low];
  return points[low - 1];
}
function samePublishedOutput(previous: ChartNumericOutput | undefined, next: ChartNumericOutput) {
  if (!previous || previous.title !== next.title || previous.contextId !== next.contextId || previous.contextRevision !== next.contextRevision
    || previous.unit !== next.unit || previous.available !== next.available || previous.quantity !== next.quantity || previous.marketScope !== next.marketScope
    || previous.sourceScope !== next.sourceScope || previous.timestampConvention !== next.timestampConvention || previous.quality !== next.quality
    || JSON.stringify(previous.resets) !== JSON.stringify(next.resets) || previous.times.length !== next.times.length || previous.values.length !== next.values.length) return false;
  for (let index = 0; index < next.times.length; index++) if (previous.times[index] !== next.times[index] || previous.values[index] !== next.values[index]) return false;
  return true;
}

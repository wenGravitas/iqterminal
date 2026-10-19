import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import type { Candle } from '../feed/protocol';
import type { NetPositioningCandle, NetPositioningFeedStatus, NetPositioningMethod, NetPositioningSide, NetPositioningUnitVerification, NetPositioningVenue } from '../feed/net-positioning';

const VENUE_ORDER: readonly NetPositioningVenue[] = ['binance', 'hyperliquid'];
const MAX_HOST_BARS = 5_000;

export function netPositioningVenueSlot(venue: NetPositioningVenue) { return VENUE_ORDER.indexOf(venue); }

/** Side-by-side signed quantities on the same candle axis; absent venues keep their slot. */
export class NetPositioningPane implements IPrimitive {
  private host?: PrimitiveHost;
  private side: NetPositioningSide;
  private method: NetPositioningMethod = 'price-oi';
  private venues: NetPositioningVenue[] = ['binance'];
  private intervalMs = 60_000;
  private readonly candles = new Map<number, NetPositioningCandle>();
  private readonly candleMaxima = new Map<number, number>();
  private readonly sortedMaxima: number[] = [];
  private hostTimes: number[] = [];
  private hostClosed = new Map<number, boolean>();
  private feeds: Partial<Record<NetPositioningVenue, NetPositioningFeedStatus>> = {};
  private unitVerification: Partial<Record<NetPositioningVenue, NetPositioningUnitVerification>> = {};
  private pendingIntervals = 0;
  private error = '';
  private colors = { binance: '#45b69c', hyperliquid: '#d76559' };
  private drawCount = 0;
  private barsDrawn = 0;
  private patches = 0;
  private snapshots = 0;

  constructor(readonly id: string, side: NetPositioningSide) { this.side = side; }
  zOrder() { return 'normal' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; }
  setColors(binance: string, hyperliquid: string) { this.colors = { binance, hyperliquid }; this.host?.requestUpdate(); }

  setSettings(side: NetPositioningSide, method: NetPositioningMethod, venues: readonly NetPositioningVenue[], intervalMs: number) {
    this.side = side; this.method = method; this.venues = VENUE_ORDER.filter(venue => venues.includes(venue)); this.intervalMs = intervalMs;
    const previous = [...this.candles.values()];
    this.candles.clear(); this.candleMaxima.clear(); this.sortedMaxima.length = 0;
    for (const candle of previous) this.setCandle(candle);
    this.host?.requestUpdate();
  }

  setMetadata(feeds: NetPositioningPane['feeds'], unitVerification: NetPositioningPane['unitVerification'], pendingIntervals: number, error = '') {
    this.feeds = feeds; this.unitVerification = unitVerification; this.pendingIntervals = pendingIntervals; this.error = error; this.host?.requestUpdate();
  }

  setHostSnapshot(candles: readonly Pick<Candle, 't' | 'closed'>[]) {
    this.hostTimes = candles.slice(-MAX_HOST_BARS).map(candle => candle.t);
    this.hostClosed = new Map(candles.slice(-MAX_HOST_BARS).map(candle => [candle.t, candle.closed]));
    this.host?.requestUpdate();
  }

  patchHostCandles(candles: readonly Candle[]) {
    for (const candle of candles) {
      if (!this.hostClosed.has(candle.t)) {
        const index = lowerBound(this.hostTimes, candle.t);
        if (this.hostTimes[index] !== candle.t) this.hostTimes.splice(index, 0, candle.t);
      }
      this.hostClosed.set(candle.t, candle.closed);
    }
    if (this.hostTimes.length > MAX_HOST_BARS) {
      const removed = this.hostTimes.splice(0, this.hostTimes.length - MAX_HOST_BARS);
      for (const time of removed) this.hostClosed.delete(time);
    }
    this.host?.requestUpdate();
  }

  setSnapshot(candles: readonly NetPositioningCandle[]) {
    this.candles.clear(); this.candleMaxima.clear(); this.sortedMaxima.length = 0;
    for (const candle of candles) this.setCandle(candle);
    this.snapshots++; this.host?.requestUpdate();
  }

  patch(candles: readonly NetPositioningCandle[]) {
    if (!candles.length) return;
    for (const candle of candles) this.setCandle(candle);
    this.patches += candles.length; this.host?.requestUpdate();
  }

  private setCandle(candle: NetPositioningCandle) {
    const venues: NetPositioningCandle['venues'] = {};
    let maximum = 0;
    for (const venue of this.venues) {
      const data = candle.venues[venue];
      if (!data) continue;
      venues[venue] = data;
      if (data.availableIntervals > 0) {
        const value = this.side === 'longs' ? data.netLongsBtc : data.netShortsBtc;
        maximum = Math.max(maximum, Math.abs(value));
      }
    }
    this.removeMaximum(candle.timeMs);
    if (Object.keys(venues).length) this.candles.set(candle.timeMs, { timeMs: candle.timeMs, venues });
    else this.candles.delete(candle.timeMs);
    if (maximum > 0 && Number.isFinite(maximum)) {
      this.candleMaxima.set(candle.timeMs, maximum);
      insertSorted(this.sortedMaxima, maximum);
    }
  }

  private removeMaximum(timeMs: number) {
    const previous = this.candleMaxima.get(timeMs);
    if (previous === undefined) return;
    this.candleMaxima.delete(timeMs);
    const at = lowerBound(this.sortedMaxima, previous);
    if (this.sortedMaxima[at] === previous) this.sortedMaxima.splice(at, 1);
  }

  autoscaleInfo() {
    const max = this.sortedMaxima.at(-1) ?? 0;
    if (!max) return null;
    const padded = max * 1.12;
    return { min: -padded, max: padded };
  }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    this.drawCount++;
    this.barsDrawn = 0;
    if (rc.plotWidth <= 0 || rc.plotHeight <= 0) return;
    const range = rc.timeScale.visibleRange();
    const from = Math.max(0, Math.floor(range.from) - 1);
    const to = Math.min(this.hostTimes.length, Math.ceil(range.to) + 1);
    const spacing = rc.timeScale.barSpacing;
    const groupWidth = Math.max(1, Math.min(spacing * .84, 64));
    const gap = Math.min(1, groupWidth * .05), slotWidth = Math.max(.5, (groupWidth - gap) / 2);
    const scaleMax = this.sortedMaxima.at(-1) ?? 0;
    const baseline = rc.priceScale.priceToY(0);
    const dpr = rc.dpr;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * dpr, rc.plotHeight * dpr); ctx.clip();
    const title = `${this.side === 'longs' ? 'Net Longs' : 'Net Shorts'} — Estimated · ${this.method === 'price-oi' ? 'Price + OI' : 'Aggressor Flow + OI'} · ${this.venues.map(venue => venue === 'binance' ? 'BN' : 'HL').join(' + ')}`;
    ctx.font = `${10 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top'; ctx.fillStyle = rc.theme?.axisText ?? '#aaa'; ctx.globalAlpha = .8;
    ctx.fillText(title, 6 * dpr, 5 * dpr, Math.max(0, rc.plotWidth * dpr - 12 * dpr));
    const health = this.error || this.venues.map(venue => `${venue === 'binance' ? 'BN' : 'HL'} ${this.feeds[venue]?.state ?? 'starting'}${this.feeds[venue]?.stale ? ' · stale' : ''}`).join(' · ');
    if (health && rc.plotHeight > 24) { ctx.globalAlpha = this.error ? .9 : .55; ctx.fillText(health, 6 * dpr, 18 * dpr, Math.max(0, rc.plotWidth * dpr - 12 * dpr)); }
    if (!this.hostTimes.length || !this.candles.size) {
      ctx.globalAlpha = .68; ctx.fillText(this.error || (this.pendingIntervals ? `${this.pendingIntervals} source interval(s) pending finalization` : 'Waiting for recorded source intervals · no values are filled or interpolated'),
        6 * dpr, 33 * dpr, Math.max(0, rc.plotWidth * dpr - 12 * dpr));
      ctx.restore(); return;
    }
    if (scaleMax > 0) {
      ctx.strokeStyle = rc.theme?.axisText ?? '#888'; ctx.globalAlpha = .4; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(0, Math.round(baseline * dpr) + .5); ctx.lineTo(rc.plotWidth * dpr, Math.round(baseline * dpr) + .5); ctx.stroke();
    }
    for (let index = from; index < to; index++) {
      const timeMs = this.hostTimes[index]; if (timeMs === undefined) continue;
      const bar = this.candles.get(timeMs); if (!bar) continue;
      const x = rc.timeScale.indexToX(index);
      if (x + groupWidth / 2 < 0 || x - groupWidth / 2 > rc.plotWidth) continue;
      for (const venue of VENUE_ORDER) {
        const value = bar.venues[venue];
        if (!value || value.availableIntervals <= 0) continue;
        const slot = netPositioningVenueSlot(venue);
        const left = x - groupWidth / 2 + slot * (slotWidth + gap);
        const amount = this.side === 'longs' ? value.netLongsBtc : value.netShortsBtc;
        const y = rc.priceScale.priceToY(amount);
        const top = Math.min(y, baseline), height = Math.max(1 / dpr, Math.abs(y - baseline));
        const partial = value.unavailableIntervals > 0 || (this.method === 'aggressor-flow-oi' && value.flowUnavailableIntervals > 0);
        ctx.fillStyle = this.colors[venue]; ctx.globalAlpha = partial ? .62 : .92;
        const pixelLeft = Math.round(left * dpr), pixelRight = Math.max(pixelLeft + 1, Math.round((left + slotWidth) * dpr));
        if (amount === 0) {
          // A thin tick is a genuine observed zero; no column means no observation.
          const zeroY = Math.round(baseline * dpr);
          ctx.globalAlpha = .96; ctx.fillRect(pixelLeft, zeroY, pixelRight - pixelLeft, Math.max(1, dpr));
        } else ctx.fillRect(pixelLeft, Math.round(top * dpr), pixelRight - pixelLeft, Math.max(1, Math.round(height * dpr)));
        this.barsDrawn++;
      }
    }
    ctx.restore();
  }

  tooltip(timeMs: number) {
    const candle = this.candles.get(timeMs);
    if (!candle) return null;
    const closed = this.hostClosed.get(timeMs) === true;
    const title = this.side === 'longs' ? 'Net Longs — Estimated' : 'Net Shorts — Estimated';
    const method = this.method === 'price-oi' ? 'Price + OI' : 'Aggressor Flow + OI';
    const intervalLabel = `${this.intervalMs >= 3_600_000 ? `${this.intervalMs / 3_600_000}h` : this.intervalMs >= 60_000 ? `${this.intervalMs / 60_000}m` : `${this.intervalMs / 1000}s`} bar`;
    const lines = [`${title} · ${method} · ${intervalLabel}`, new Date(timeMs).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC'), closed ? 'Confirmed host candle' : 'Provisional · host candle still forming'];
    for (const venue of this.venues) {
      const label = venue === 'binance' ? 'Binance · BTCUSDT USD-M Perp' : 'Hyperliquid · BTC Perp';
      const data = candle.venues[venue];
      const feed = this.feeds[venue], unit = this.unitVerification[venue];
      if (!data) { lines.push(`${label} · no observed source interval`); continue; }
      const total = data.availableIntervals + data.unavailableIntervals;
      lines.push(`${label} · ${data.availableIntervals}/${total} source intervals available${data.unavailableIntervals ? ` · ${data.unavailableIntervals} unavailable` : ''}`);
      if (data.availableIntervals) {
        lines.push(`Net longs ${signed(data.netLongsBtcDecimal)} BTC · Net shorts ${signed(data.netShortsBtcDecimal)} BTC`);
        lines.push(`Unclassified ${signed(data.unclassifiedBtcDecimal)} BTC · OI Δ ${signed(data.oiDeltaBtcDecimal)} BTC`);
        const latest = data.observations.at(-1)!;
        const resolution = data.minResolutionMs === data.maxResolutionMs ? `${formatDuration(data.minResolutionMs)} source intervals` : `${formatDuration(data.minResolutionMs)}–${formatDuration(data.maxResolutionMs)} source interval resolution`;
        lines.push(`${resolution} · latest source interval ${utc(latest.startTimeMs)}–${utc(latest.endTimeMs)} UTC · ${latest.provenance.openInterestEnd?.sourceTimeQuality ?? 'source timing unlabelled'}`);
        if (this.method === 'price-oi') {
          const start = latest.provenance.priceStart?.price, end = latest.provenance.priceEnd?.price;
          if (Number.isFinite(start) && Number.isFinite(end)) lines.push(`Latest interval price ${price(start!)} → ${price(end!)} USDT${latest.qualityFlags.length ? ` · ${latest.qualityFlags.join(', ')}` : ''}`);
          else lines.push(`Latest interval price unavailable${latest.qualityFlags.length ? ` · ${latest.qualityFlags.join(', ')}` : ''}`);
        } else {
          if (data.aggressorBuyBtc !== null && data.aggressorSellBtc !== null) {
            lines.push(`Aggressor flow · buy ${formatBtcFromNumber(data.aggressorBuyBtc)} BTC · sell ${formatBtcFromNumber(data.aggressorSellBtc)} BTC · ${data.flowAvailableIntervals}/${data.flowAvailableIntervals + data.flowUnavailableIntervals} intervals with complete trade coverage`);
          } else lines.push(`Aggressor flow unavailable · ${data.flowAvailableIntervals}/${data.flowAvailableIntervals + data.flowUnavailableIntervals} intervals with complete trade coverage`);
        }
      } else lines.push(`No classified estimate · ${data.unavailableIntervals} unavailable interval(s)`);
      const last = feed?.lastObservedAt;
      const age = last ? `${formatDuration(Math.max(0, Date.now() - last))} since source update` : 'source freshness unavailable';
      const freshness = feed?.stale || feed?.state === 'stale' ? 'stale' : feed?.state ?? 'starting';
      lines.push(`Feed ${freshness} · ${age} · BTC units ${unit?.status ?? 'unverified'}`);
    }
    if (this.pendingIntervals) lines.push(`${this.pendingIntervals} source interval(s) pending recorder finalization`);
    if (this.error) lines.push(this.error);
    return lines.join('\n');
  }

  setError(message: string) { this.error = message; this.host?.requestUpdate(); }
  diagnostics() {
    return { mounted: Boolean(this.host), side: this.side, method: this.method, venues: [...this.venues], candleCount: this.candles.size,
      visibleDraws: this.drawCount, visibleBarsDrawn: this.barsDrawn, sourcePatches: this.patches, snapshots: this.snapshots,
      retainedScaleBars: this.sortedMaxima.length, maxAbsBtc: this.sortedMaxima.at(-1) ?? 0,
      feeds: Object.fromEntries(this.venues.map(venue => [venue, this.feeds[venue] ?? null])),
      unitVerification: Object.fromEntries(this.venues.map(venue => [venue, this.unitVerification[venue] ?? null])),
      pendingIntervals: this.pendingIntervals, error: this.error };
  }
}

function lowerBound(values: readonly number[], target: number) {
  let lo = 0, hi = values.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid]! < target) lo = mid + 1; else hi = mid; }
  return lo;
}
function insertSorted(values: number[], value: number) { const index = lowerBound(values, value); values.splice(index, 0, value); }
function formatBtc(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.abs(number).toLocaleString('en-US', { minimumFractionDigits: number === 0 ? 0 : undefined, maximumFractionDigits: 8 }) : 'unavailable';
}
function signed(value: string) { const number = Number(value); return Number.isFinite(number) ? `${number > 0 ? '+' : number < 0 ? '−' : ''}${formatBtc(value)}` : 'unavailable'; }
function formatBtcFromNumber(value: number) { return value.toLocaleString('en-US', { maximumFractionDigits: 8 }); }
function formatDuration(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return 'unknown';
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000}m`;
}
function utc(ms: number) { return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', '').replace('Z', ''); }
function price(value: number) { return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

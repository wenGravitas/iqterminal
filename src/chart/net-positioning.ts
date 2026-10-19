import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import type { Candle } from '../feed/protocol';
import type { NetPositioningCandle, NetPositioningFeedStatus, NetPositioningMethod, NetPositioningSide, NetPositioningUnitVerification, NetPositioningVenue } from '../feed/net-positioning';
import { groupedSourceSlot, layoutNetPositioningSources, roundDprBoundary, type NetPositioningDisplay, type NetPositioningQuality } from './net-positioning-layout';

const VENUE_ORDER: readonly NetPositioningVenue[] = ['binance', 'hyperliquid'];
const MAX_HOST_BARS = 5_000;

export function netPositioningVenueSlot(venue: NetPositioningVenue) { return VENUE_ORDER.indexOf(venue); }

export type NetPositioningLabels = 'auto' | 'hover' | 'off';
export type NetPositioningTheme = 'dark' | 'light';
export type NetPositioningSourceColors = Record<NetPositioningVenue, string>;
export const NET_POSITIONING_SOURCE_PALETTES: Record<NetPositioningTheme, NetPositioningSourceColors> = {
  dark: { binance: '#c39b58', hyperliquid: '#719aca' },
  light: { binance: '#946820', hyperliquid: '#3e71a6' },
};
export function netPositioningSourceColors(theme: NetPositioningTheme): NetPositioningSourceColors {
  return { ...NET_POSITIONING_SOURCE_PALETTES[theme] };
}
export function netPositioningTextColor(color: string, background: string): '#111111' | '#f5f5f5' {
  const channels = (hex: string) => {
    if (!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return null;
    const raw = hex.slice(1), expanded = raw.length <= 4 ? [...raw].map(value => value + value).join('') : raw;
    const hasAlpha = expanded.length === 8;
    return { rgb: [0, 2, 4].map(offset => Number.parseInt(expanded.slice(offset, offset + 2), 16)), alpha: hasAlpha ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1 };
  };
  const source = channels(color), under = channels(background) ?? { rgb: [9, 9, 9], alpha: 1 };
  const rgb = source ? source.rgb.map((value, index) => value * source.alpha + under.rgb[index]! * (1 - source.alpha)) : [128, 128, 128];
  const luminance = rgb.map(value => { const linear = value / 255; return linear <= .04045 ? linear / 12.92 : ((linear + .055) / 1.055) ** 2.4; })
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
  const blackContrast = (luminance + .05) / .05, whiteContrast = 1.05 / (luminance + .05);
  return blackContrast >= whiteContrast ? '#111111' : '#f5f5f5';
}
interface SegmentGeometry { sourceId: NetPositioningVenue; timeMs: number; left: number; top: number; right: number; bottom: number; value: number; quality: NetPositioningQuality; zero: boolean }

/** Side-by-side signed quantities on the same candle axis; absent venues keep their slot. */
export class NetPositioningPane implements IPrimitive {
  private host?: PrimitiveHost;
  private side: NetPositioningSide;
  private method: NetPositioningMethod = 'price-oi';
  private venues: NetPositioningVenue[] = ['binance'];
  private display: NetPositioningDisplay = 'stacked';
  private labels: NetPositioningLabels = 'auto';
  private intervalMs = 60_000;
  private readonly candles = new Map<number, NetPositioningCandle>();
  private hostTimes: number[] = [];
  private hostClosed = new Map<number, boolean>();
  private visibleFrom = 0;
  private visibleTo = Number.POSITIVE_INFINITY;
  private visibleMin = 0;
  private visibleMax = 0;
  private hasVisibleZero = false;
  private feeds: Partial<Record<NetPositioningVenue, NetPositioningFeedStatus>> = {};
  private unitVerification: Partial<Record<NetPositioningVenue, NetPositioningUnitVerification>> = {};
  private pendingIntervals = 0;
  private error = '';
  private defaultColors = netPositioningSourceColors('dark');
  private colorOverrides: Partial<Record<NetPositioningVenue, string>> = {};
  private colors = netPositioningSourceColors('dark');
  private geometry: SegmentGeometry[] = [];
  private highlightedSource: NetPositioningVenue | null = null;
  private hovered: { sourceId: NetPositioningVenue; timeMs: number } | null = null;
  private drawCount = 0;
  private barsDrawn = 0;
  private patches = 0;
  private snapshots = 0;

  constructor(readonly id: string, side: NetPositioningSide) { this.side = side; }
  zOrder() { return 'normal' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; }
  setColors(binance: string, hyperliquid: string) {
    this.defaultColors = { binance, hyperliquid };
    this.applyColors();
  }
  setThemeColors(colors: NetPositioningSourceColors) {
    if (colors.binance === this.defaultColors.binance && colors.hyperliquid === this.defaultColors.hyperliquid) return;
    this.defaultColors = { ...colors };
    this.applyColors();
  }
  setColorOverrides(colors: Partial<Record<NetPositioningVenue, string>> | undefined) {
    const next = { ...(colors ?? {}) };
    if (next.binance === this.colorOverrides.binance && next.hyperliquid === this.colorOverrides.hyperliquid) return;
    this.colorOverrides = next;
    this.applyColors();
  }
  private applyColors() {
    this.colors = { ...this.defaultColors, ...this.colorOverrides };
    this.host?.requestUpdate();
  }
  sourceColor(venue: NetPositioningVenue) { return this.colors[venue]; }

  setSettings(side: NetPositioningSide, method: NetPositioningMethod, venues: readonly NetPositioningVenue[], intervalMs: number, display: NetPositioningDisplay = 'stacked', labels: NetPositioningLabels = 'auto') {
    const nextVenues = VENUE_ORDER.filter(venue => venues.includes(venue));
    const filterChanged = this.side !== side || this.method !== method || this.intervalMs !== intervalMs || JSON.stringify(this.venues) !== JSON.stringify(nextVenues);
    this.side = side; this.method = method; this.venues = nextVenues; this.intervalMs = intervalMs; this.display = display; this.labels = labels;
    if (filterChanged) {
      const previous = [...this.candles.values()]; this.candles.clear();
      for (const candle of previous) this.setCandle(candle);
    }
    this.recomputeVisibleScale();
    this.geometry = [];
    this.host?.requestUpdate();
  }

  setVisibleRange(from: number, to: number) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (this.visibleFrom === from && this.visibleTo === to) return;
    this.visibleFrom = from; this.visibleTo = to;
    this.recomputeVisibleScale(); this.geometry = [];
    this.host?.requestUpdate();
  }

  highlightSource(source: NetPositioningVenue | null) { this.highlightedSource = source; this.hovered = null; this.host?.requestUpdate(); }

  setMetadata(feeds: NetPositioningPane['feeds'], unitVerification: NetPositioningPane['unitVerification'], pendingIntervals: number, error = '') {
    this.feeds = feeds; this.unitVerification = unitVerification; this.pendingIntervals = pendingIntervals; this.error = error; this.host?.requestUpdate();
  }

  setHostSnapshot(candles: readonly Pick<Candle, 't' | 'closed'>[]) {
    this.hostTimes = candles.slice(-MAX_HOST_BARS).map(candle => candle.t);
    this.hostClosed = new Map(candles.slice(-MAX_HOST_BARS).map(candle => [candle.t, candle.closed]));
    this.recomputeVisibleScale(); this.geometry = [];
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
    this.recomputeVisibleScale(); this.geometry = [];
    this.host?.requestUpdate();
  }

  setSnapshot(candles: readonly NetPositioningCandle[]) {
    this.candles.clear();
    for (const candle of candles) this.setCandle(candle);
    this.snapshots++; this.recomputeVisibleScale(); this.geometry = []; this.host?.requestUpdate();
  }

  patch(candles: readonly NetPositioningCandle[]) {
    if (!candles.length) return;
    for (const candle of candles) this.setCandle(candle);
    this.patches += candles.length; this.recomputeVisibleScale(); this.geometry = []; this.host?.requestUpdate();
  }

  private setCandle(candle: NetPositioningCandle) {
    const venues: NetPositioningCandle['venues'] = {};
    for (const venue of this.venues) {
      const data = candle.venues[venue];
      if (!data) continue;
      venues[venue] = data;
    }
    if (Object.keys(venues).length) this.candles.set(candle.timeMs, { timeMs: candle.timeMs, venues });
    else this.candles.delete(candle.timeMs);
  }

  autoscaleInfo() {
    if (this.visibleMin === 0 && this.visibleMax === 0) return this.hasVisibleZero ? { min: -1, max: 1 } : null;
    const pad = (this.visibleMax - this.visibleMin) * .08;
    return { min: this.visibleMin < 0 ? this.visibleMin - pad : 0, max: this.visibleMax > 0 ? this.visibleMax + pad : 0 };
  }

  private recomputeVisibleScale() {
    let min = 0, max = 0, zero = false;
    const from = Math.max(0, Math.floor(this.visibleFrom));
    const to = Math.min(this.hostTimes.length, Math.ceil(this.visibleTo));
    for (let index = from; index < to; index++) {
      const candle = this.candles.get(this.hostTimes[index]!); if (!candle) continue;
      const sources = this.sourceValues(candle);
      const layout = layoutNetPositioningSources(sources, this.display);
      if (sources.some(source => source.value === 0)) zero = true;
      if (this.display === 'stacked') { min = Math.min(min, layout.negativeTotal); max = Math.max(max, layout.positiveTotal); }
      else {
        for (const source of sources) if (source.value !== null) { min = Math.min(min, source.value); max = Math.max(max, source.value); }
      }
    }
    this.visibleMin = min; this.visibleMax = max; this.hasVisibleZero = zero;
  }

  private sourceValues(candle: NetPositioningCandle) {
    return this.venues.map(sourceId => {
      const data = candle.venues[sourceId];
      if (!data) return { sourceId, value: null, quality: 'missing' as const };
      if (data.availableIntervals <= 0) return { sourceId, value: null, quality: 'unavailable' as const };
      const value = this.side === 'longs' ? data.netLongsBtc : data.netShortsBtc;
      const partial = data.unavailableIntervals > 0 || (this.method === 'aggressor-flow-oi' && data.flowUnavailableIntervals > 0);
      return { sourceId, value, quality: partial ? 'partial' as const : 'complete' as const };
    });
  }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    this.drawCount++;
    this.barsDrawn = 0;
    this.geometry = [];
    if (rc.plotWidth <= 0 || rc.plotHeight <= 0) return;
    const range = rc.timeScale.visibleRange();
    const from = Math.max(0, Math.floor(range.from) - 1);
    const to = Math.min(this.hostTimes.length, Math.ceil(range.to) + 1);
    const spacing = rc.timeScale.barSpacing;
    const groupWidth = Math.max(1, Math.min(spacing * .84, 64));
    const baseline = rc.priceScale.priceToY(0);
    const dpr = rc.dpr;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * dpr, rc.plotHeight * dpr); ctx.clip();
    const title = `${this.side === 'longs' ? 'Net Longs' : 'Net Shorts'} Est. · ${this.method === 'price-oi' ? 'Price+OI' : 'Flow+OI'} · ${this.display === 'stacked' ? 'Stacked' : 'Grouped'}`;
    ctx.font = `${9 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top'; ctx.fillStyle = rc.theme?.axisText ?? '#aaa'; ctx.globalAlpha = .8;
    ctx.fillText(title, 6 * dpr, 5 * dpr, Math.max(0, rc.plotWidth * dpr - 12 * dpr));
    const health = this.error || this.venues.map(venue => `${venueShort(venue)} ${this.feeds[venue]?.state ?? 'starting'}${this.feeds[venue]?.stale ? ' · stale' : ''}`).join(' · ');
    if (health && rc.plotHeight > 24) { ctx.globalAlpha = this.error ? .9 : .55; ctx.fillText(health, 6 * dpr, 18 * dpr, Math.max(0, rc.plotWidth * dpr - 12 * dpr)); }
    if (!this.hostTimes.length || !this.candles.size) {
      ctx.globalAlpha = .68; ctx.fillText(this.error || (this.pendingIntervals ? `${this.pendingIntervals} source interval(s) pending finalization` : 'Waiting for recorded source intervals · no values are filled or interpolated'),
        6 * dpr, 33 * dpr, Math.max(0, rc.plotWidth * dpr - 12 * dpr));
      ctx.restore(); return;
    }
    ctx.strokeStyle = rc.theme?.axisText ?? '#888'; ctx.globalAlpha = .35; ctx.lineWidth = dpr;
    const baselinePx = roundDprBoundary(baseline, dpr);
    ctx.beginPath(); ctx.moveTo(0, baselinePx + .5); ctx.lineTo(rc.plotWidth * dpr, baselinePx + .5); ctx.stroke();
    for (let index = from; index < to; index++) {
      const timeMs = this.hostTimes[index]; if (timeMs === undefined) continue;
      const bar = this.candles.get(timeMs); if (!bar) continue;
      const x = rc.timeScale.indexToX(index);
      if (x + groupWidth / 2 < 0 || x - groupWidth / 2 > rc.plotWidth) continue;
      const layout = layoutNetPositioningSources(this.sourceValues(bar), this.display);
      for (const segment of layout.segments) {
        if (segment.value === null || segment.start === null || segment.end === null) continue;
        const venue = segment.sourceId as NetPositioningVenue;
        const groupSlot = groupedSourceSlot(venue, this.venues, VENUE_ORDER, x, groupWidth);
        const left = this.display === 'stacked' ? x - groupWidth / 2 : groupSlot?.left ?? x - groupWidth / 2;
        const width = this.display === 'stacked' ? groupWidth : groupSlot?.width ?? groupWidth;
        const right = left + width;
        const yStart = rc.priceScale.priceToY(segment.start), yEnd = rc.priceScale.priceToY(segment.end);
        const topPx = Math.min(roundDprBoundary(yStart, dpr), roundDprBoundary(yEnd, dpr));
        const bottomPx = Math.max(roundDprBoundary(yStart, dpr), roundDprBoundary(yEnd, dpr));
        const leftPx = roundDprBoundary(left, dpr), rightPx = Math.max(leftPx + 1, roundDprBoundary(right, dpr));
        const hoverKey = `${venue}:${timeMs}`;
        const hovered = this.hovered?.sourceId === venue && this.hovered.timeMs === timeMs;
        const highlighted = this.highlightedSource ?? (rc.hoverKey?.startsWith('legend:') ? rc.hoverKey.slice('legend:'.length) as NetPositioningVenue : null);
        const dimmed = Boolean(highlighted && highlighted !== venue);
        const color = this.colors[venue];
        const partial = segment.quality === 'partial';
        ctx.fillStyle = color; ctx.globalAlpha = dimmed ? .2 : partial ? .62 : .9;
        if (segment.sign === 'zero') {
          // A true observed zero gets a one-device-pixel tick; missing rows remain blank.
          const zeroTop = baselinePx;
          ctx.globalAlpha = dimmed ? .25 : .95; ctx.fillRect(leftPx, zeroTop, rightPx - leftPx, Math.max(1, Math.round(dpr)));
        } else if (bottomPx > topPx) {
          ctx.fillRect(leftPx, topPx, rightPx - leftPx, bottomPx - topPx);
        }
        const top = topPx / dpr, bottom = bottomPx / dpr;
        const geometry: SegmentGeometry = { sourceId: venue, timeMs, left, top, right, bottom, value: segment.value, quality: segment.quality, zero: segment.sign === 'zero' };
        this.geometry.push(geometry);
        const isHovered = hovered || rc.hoverKey === hoverKey;
        if (isHovered) {
          ctx.strokeStyle = rc.theme?.axisText ?? '#eee'; ctx.lineWidth = Math.max(1, dpr); ctx.globalAlpha = .9;
          const inset = Math.max(.5, dpr / 2); ctx.strokeRect(leftPx + inset, topPx + inset, Math.max(0, rightPx - leftPx - inset * 2), Math.max(0, bottomPx - topPx - inset * 2));
        }
        const labelText = formatBtc(String(segment.value));
        const labelVisible = this.labels === 'auto' ? right - left >= 46 : this.labels === 'hover' && isHovered;
        if (labelVisible && segment.sign !== 'zero') {
          ctx.font = `${9 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
          const metrics = ctx.measureText(labelText);
          const textHeight = Math.max(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent, 9 * dpr);
          const widthPx = rightPx - leftPx, heightPx = bottomPx - topPx;
          if (metrics.width + 4 * dpr <= widthPx && textHeight + 4 * dpr <= heightPx) {
            ctx.save(); ctx.beginPath(); ctx.rect(leftPx, topPx, widthPx, heightPx); ctx.clip();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = netPositioningTextColor(color, rc.theme?.background ?? '#090909'); ctx.globalAlpha = dimmed ? .25 : .9;
            ctx.fillText(labelText, (leftPx + rightPx) / 2, (topPx + bottomPx) / 2);
            ctx.restore();
          }
        }
        this.barsDrawn++;
      }
    }
    ctx.textAlign = 'start';
    ctx.restore();
  }

  hitTest(x: number, y: number, _rc: PrimitiveRenderContext) {
    let nearest: SegmentGeometry | undefined, distance = Number.POSITIVE_INFINITY;
    for (const item of this.geometry) {
      const dx = x < item.left ? item.left - x : x > item.right ? x - item.right : 0;
      const dy = y < item.top ? item.top - y : y > item.bottom ? y - item.bottom : 0;
      const d = Math.hypot(dx, dy);
      if (d <= 3 && d < distance) { nearest = item; distance = d; }
    }
    if (!nearest) { this.hovered = null; return null; }
    this.hovered = { sourceId: nearest.sourceId, timeMs: nearest.timeMs };
    return { externalId: this.id, hoverKey: `${nearest.sourceId}:${nearest.timeMs}`, zOrder: 'normal' as const, distance };
  }
  tooltip(timeMs: number) {
    const candle = this.candles.get(timeMs);
    if (!candle) return null;
    const closed = this.hostClosed.get(timeMs) === true;
    const title = this.side === 'longs' ? 'Net Longs — Estimated' : 'Net Shorts — Estimated';
    const method = this.method === 'price-oi' ? 'Price + OI' : 'Aggressor Flow + OI';
    const intervalLabel = `${this.intervalMs >= 3_600_000 ? `${this.intervalMs / 3_600_000}h` : this.intervalMs >= 60_000 ? `${this.intervalMs / 60_000}m` : `${this.intervalMs / 1000}s`} bar`;
    const lines = [`${title} · ${method} · ${this.display} · ${intervalLabel}`, new Date(timeMs).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC'), closed ? 'Confirmed host candle' : 'Provisional · host candle still forming'];
    const layout = candle ? layoutNetPositioningSources(this.sourceValues(candle), this.display) : null;
    if (layout) {
      lines.push(`${this.display === 'stacked' ? 'Diverging stack' : 'Grouped'} · positive ${signed(String(layout.positiveTotal))} BTC · negative ${signed(String(layout.negativeTotal))} BTC`);
      const hovered = this.hovered?.timeMs === timeMs ? layout.segments.find(segment => segment.sourceId === this.hovered?.sourceId) : undefined;
      if (hovered) lines.push(`${venueLabel(hovered.sourceId as NetPositioningVenue)} segment · ${hovered.value === null ? hovered.quality : `${signed(String(hovered.value))} BTC · ${hovered.quality}`}`);
    }
    for (const venue of this.venues) {
      const label = venueLabel(venue);
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
      display: this.display, labels: this.labels, visibleScaleBars: this.hostTimes.slice(Math.max(0, Math.floor(this.visibleFrom)), Math.min(this.hostTimes.length, Math.ceil(this.visibleTo))).filter(time => this.candles.has(time)).length,
      visibleScaleMinBtc: this.visibleMin, visibleScaleMaxBtc: this.visibleMax, maxAbsBtc: Math.max(Math.abs(this.visibleMin), Math.abs(this.visibleMax)),
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
function venueShort(venue: NetPositioningVenue) { return venue === 'binance' ? 'BN' : 'HL'; }
function venueLabel(venue: NetPositioningVenue) { return venue === 'binance' ? 'Binance · BTCUSDT USD-M Perp' : 'Hyperliquid · BTC Perp'; }
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

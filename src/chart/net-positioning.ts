import {candleGeometry} from 'openalgo-charts';
import { netPositioningQuote } from '../feed/net-positioning';
import type { QuantityCurrency } from '../currency-display';
import type { IPrimitive, PriceScale, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import type { Candle } from '../feed/protocol';
import type { NetPositioningCandle, NetPositioningFeedStatus, NetPositioningMethod, NetPositioningSide, NetPositioningUnitVerification, NetPositioningVenue } from '../feed/net-positioning';
import { groupedSourceSlot, layoutNetPositioningSources, netPositioningBands, roundDprBoundary, type NetPositioningBand, type NetPositioningDisplay, type NetPositioningQuality } from './net-positioning-layout';

const VENUE_ORDER: readonly NetPositioningVenue[] = ['binance', 'hyperliquid', 'bybit'];
const PANE_HEADER_HEIGHT = 30;
const MAX_HOST_BARS = 5_000;

export function netPositioningVenueSlot(venue: NetPositioningVenue) { return VENUE_ORDER.indexOf(venue); }

export type NetPositioningLabels = 'auto' | 'hover' | 'off';
export type NetPositioningTheme = 'dark' | 'light' | 'terminal' | 'ios';
export type NetPositioningSourceColors = Record<NetPositioningVenue, string>;
export const NET_POSITIONING_SOURCE_PALETTES: Record<NetPositioningTheme, Record<NetPositioningSide, NetPositioningSourceColors>> = {
  dark: { longs: { binance: '#58a65c', hyperliquid: '#85c98b', bybit: '#b1d677' }, shorts: { binance: '#ad5858', hyperliquid: '#d98a8a', bybit: '#d9a376' } },
  terminal: { longs: { binance: '#38d984', hyperliquid: '#79eaa4', bybit: '#a8e7b8' }, shorts: { binance: '#ff687a', hyperliquid: '#ff98a4', bybit: '#ffc183' } },
  ios: { longs: { binance: '#248a3d', hyperliquid: '#30a450', bybit: '#55985f' }, shorts: { binance: '#d70015', hyperliquid: '#e64654', bybit: '#a82437' } },
  light: { longs: { binance: '#167260', hyperliquid: '#44853e', bybit: '#626e20' }, shorts: { binance: '#b54436', hyperliquid: '#963b4e', bybit: '#93551f' } },
};
export function netPositioningSourceColors(theme: NetPositioningTheme, side: NetPositioningSide = 'longs'): NetPositioningSourceColors {
  return { ...NET_POSITIONING_SOURCE_PALETTES[theme][side] };
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
/** Lift source-coloured labels toward the contrasting foreground. */
export function netPositioningLabelColor(color: string, background: string) {
  const foreground = netPositioningTextColor(background, background);
  const raw = color.slice(1), expanded = raw.length === 3 ? [...raw].map(channel => channel + channel).join('') : raw;
  if (!/^[a-f\d]{6}$/i.test(expanded)) return foreground;
  const target = foreground === '#111111' ? 17 : 245;
  return '#' + [0, 2, 4].map(offset => Math.round(Number.parseInt(expanded.slice(offset, offset + 2), 16) * .55 + target * .45).toString(16).padStart(2, '0')).join('');
}
interface SegmentGeometry { side: NetPositioningSide; sourceId: NetPositioningVenue; timeMs: number; left: number; top: number; right: number; bottom: number; value: number; quality: NetPositioningQuality; zero: boolean }
interface SideScale { min: number; max: number; hasZero: boolean }

/** Side-by-side signed quantities on the same candle axis; absent venues keep their slot. */
export class NetPositioningPane implements IPrimitive {
  private host?: PrimitiveHost;
  private method: NetPositioningMethod = 'price-oi';
  private venues: NetPositioningVenue[] = ['binance'];
  private display: NetPositioningDisplay = 'stacked';
  private labels: NetPositioningLabels = 'auto';
  private showLongs = true;
  private showShorts = true;
  private reverseOrder = false;
  private currency: QuantityCurrency = 'btc';
  get displayCurrency() { return this.currency; }
  get displayCurrencyLabel() { return this.currency === 'btc' ? 'BTC' : 'USD'; }
  setCurrency(currency: QuantityCurrency) { if (currency === this.currency) return; this.currency = currency; this.hovered = null; this.geometry = []; this.recomputeVisibleScale(); this.host?.requestUpdate(); }
  private intervalMs = 60_000;
  private readonly candles = new Map<number, NetPositioningCandle>();
  private hostTimes: number[] = [];
  private hostClosed = new Map<number, boolean>();
  private visibleFrom = 0;
  private visibleTo = Number.POSITIVE_INFINITY;
  private visibleScale: Record<NetPositioningSide, SideScale> = { longs: { min: 0, max: 0, hasZero: false }, shorts: { min: 0, max: 0, hasZero: false } };
  private feeds: Partial<Record<NetPositioningVenue, NetPositioningFeedStatus>> = {};
  private unitVerification: Partial<Record<NetPositioningVenue, NetPositioningUnitVerification>> = {};
  private pendingIntervals = 0;
  private error = '';
  private defaultColors: Record<NetPositioningSide, NetPositioningSourceColors> = {
    longs: netPositioningSourceColors('dark', 'longs'), shorts: netPositioningSourceColors('dark', 'shorts'),
  };
  private colorOverrides: Partial<Record<NetPositioningVenue, string>> = {};
  private colors: Record<NetPositioningSide, NetPositioningSourceColors> = {
    longs: netPositioningSourceColors('dark', 'longs'), shorts: netPositioningSourceColors('dark', 'shorts'),
  };
  private geometry: SegmentGeometry[] = [];
  private highlightedSource: NetPositioningVenue | null = null;
  private hovered: { side: NetPositioningSide; sourceId: NetPositioningVenue; timeMs: number } | null = null;
  private drawCount = 0;
  private barsDrawn = 0;
  private patches = 0;
  private snapshots = 0;
  private priceScale?: PriceScale;
  private baseMarginTop = .1;
  private appliedMarginTop = .1;
  private renderedBands: NetPositioningBand[] = [];

  constructor(readonly id: string, private columnGeometry=(x:number,spacing:number,dpr:number)=>{const g=candleGeometry(x,spacing,dpr);return {left:g.bodyX/dpr,width:g.bodyW/dpr};}) {}
  zOrder() { return 'normal' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; }
  setPriceScale(scale: PriceScale) {
    this.priceScale = scale;
    this.baseMarginTop = this.appliedMarginTop = scale.options.marginTop;
    this.host?.requestUpdate();
  }
  afterAutoscale() {
    const scale = this.priceScale;
    if (!scale || !scale.autoScale || scale.height <= 0) return;
    const range = this.autoscaleInfo();
    if (!range) return;
    const current = scale.options.marginTop;
    if (Math.abs(current - this.appliedMarginTop) > .001) this.baseMarginTop = current;
    const maximum = Math.min(.9, 1 - scale.options.marginBottom - .05);
    const next = Math.max(this.baseMarginTop, Math.min(maximum, (PANE_HEADER_HEIGHT + 8) / scale.height));
    this.appliedMarginTop = next;
    if (Math.abs(current - next) <= .001) return;
    scale.setOptions({ marginTop: next });
    // setOptions only changes the margin configuration. Reapply the current
    // primitive-owned autoscale bounds now so the axis and bars share the new
    // range in this frame, including on a static chart.
    scale.autoscale(range.min, range.max);
    this.host?.requestUpdate();
  }
  setColors(binance: string, hyperliquid: string) {
    this.defaultColors = Object.fromEntries((['longs', 'shorts'] as const).map(side => [side,
      { ...this.defaultColors[side], binance, hyperliquid }])) as Record<NetPositioningSide, NetPositioningSourceColors>;
    this.applyColors();
  }
  setThemeColors(colors: NetPositioningSourceColors, side: NetPositioningSide) {
    const current = this.defaultColors[side];
    if (colors.binance === current.binance && colors.hyperliquid === current.hyperliquid && colors.bybit === current.bybit) return;
    this.defaultColors = { ...this.defaultColors, [side]: { ...colors } };
    this.applyColors();
  }
  setColorOverrides(colors: Partial<Record<NetPositioningVenue, string>> | undefined) {
    const next = { ...(colors ?? {}) };
    if (next.binance === this.colorOverrides.binance && next.hyperliquid === this.colorOverrides.hyperliquid && next.bybit === this.colorOverrides.bybit) return;
    this.colorOverrides = next;
    this.applyColors();
  }
  private applyColors() {
    this.colors = { longs: { ...this.defaultColors.longs, ...this.colorOverrides }, shorts: { ...this.defaultColors.shorts, ...this.colorOverrides } };
    this.host?.requestUpdate();
  }
  refreshColumnGeometry(){this.host?.requestUpdate();}
  sourceColor(venue: NetPositioningVenue, side: NetPositioningSide = 'longs') { return this.colors[side][venue]; }

  setSettings(method: NetPositioningMethod, venues: readonly NetPositioningVenue[], intervalMs: number, display: NetPositioningDisplay = 'stacked', labels: NetPositioningLabels = 'auto',
    showLongs = true, showShorts = true, reverseOrder = false) {
    const nextVenues = VENUE_ORDER.filter(venue => venues.includes(venue));
    const filterChanged = this.method !== method || this.intervalMs !== intervalMs || JSON.stringify(this.venues) !== JSON.stringify(nextVenues);
    this.method = method; this.venues = nextVenues; this.intervalMs = intervalMs; this.display = display; this.labels = labels;
    this.showLongs = showLongs; this.showShorts = showShorts; this.reverseOrder = reverseOrder;
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
    // The shared pane draws independently scaled Longs and Shorts bands itself;
    // this hidden anchor scale only keeps the primitive lifecycle attached.
    return { min: -1, max: 1 };
  }

  private recomputeVisibleScale() {
    const scales: Record<NetPositioningSide, SideScale> = {
      longs: { min: 0, max: 0, hasZero: false }, shorts: { min: 0, max: 0, hasZero: false },
    };
    const from = Math.max(0, Math.floor(this.visibleFrom));
    const to = Math.min(this.hostTimes.length, Math.ceil(this.visibleTo));
    for (let index = from; index < to; index++) {
      const candle = this.candles.get(this.hostTimes[index]!); if (!candle) continue;
      for (const side of ['longs', 'shorts'] as const) {
        const sources = this.sourceValues(candle, side), layout = layoutNetPositioningSources(sources, this.display), scale = scales[side];
        if (sources.some(source => source.value === 0)) scale.hasZero = true;
        if (this.display === 'stacked') { scale.min = Math.min(scale.min, layout.negativeTotal); scale.max = Math.max(scale.max, layout.positiveTotal); }
        else for (const source of sources) if (source.value !== null) { scale.min = Math.min(scale.min, source.value); scale.max = Math.max(scale.max, source.value); }
      }
    }
    this.visibleScale = scales;
  }

  private sourceValues(candle: NetPositioningCandle, side: NetPositioningSide) {
    return this.venues.map(sourceId => {
      const data = candle.venues[sourceId];
      const baseValue = data && data.availableIntervals > 0 ? side === 'longs' ? data.netLongsBtc : data.netShortsBtc : null;
      const quoteValue = data && baseValue !== null ? netPositioningQuote(data, side) : null;
      const value = this.currency === 'btc' ? baseValue : quoteValue;
      const quality = !data ? 'missing' as const : data.availableIntervals <= 0 || value === null ? 'unavailable' as const
        : data.unavailableIntervals > 0 || (this.method === 'aggressor-flow-oi' && data.flowUnavailableIntervals > 0) ? 'partial' as const : 'complete' as const;
      return { sourceId, value, baseValue, quoteValue, quality };
    });
  }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    this.drawCount++;
    this.barsDrawn = 0;
    this.geometry = [];
    this.renderedBands = [];
    if (rc.plotWidth <= 0 || rc.plotHeight <= 0) return;
    const range = rc.timeScale.visibleRange();
    const from = Math.max(0, Math.floor(range.from) - 1);
    const to = Math.min(this.hostTimes.length, Math.ceil(range.to) + 1);
    const spacing = rc.timeScale.barSpacing;
    const dpr = Number.isFinite(rc.dpr) && rc.dpr > 0 ? rc.dpr : 1;
    const baselineStrokeWidth = Math.max(1, Math.round(dpr));
    ctx.save();
    ctx.beginPath(); ctx.rect(0, PANE_HEADER_HEIGHT * dpr, rc.plotWidth * dpr, Math.max(0, rc.plotHeight - PANE_HEADER_HEIGHT) * dpr); ctx.clip();
    ctx.font = `${9 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top'; ctx.fillStyle = rc.theme?.axisText ?? '#aaa'; ctx.globalAlpha = .8;
    const health = this.error || this.venues.map(venue => `${venueShort(venue)} ${this.feeds[venue]?.state ?? 'starting'}${this.feeds[venue]?.stale ? ' · stale' : ''}`).join(' · ');
    if (health && rc.plotHeight > PANE_HEADER_HEIGHT + 10) { ctx.globalAlpha = this.error ? .9 : .55; ctx.fillText(health, 6 * dpr, (PANE_HEADER_HEIGHT + 3) * dpr, Math.max(0, rc.plotWidth * dpr - 12 * dpr)); }
    if (!this.hostTimes.length || !this.candles.size) {
      if (rc.plotHeight > PANE_HEADER_HEIGHT + 22) {
        ctx.globalAlpha = .68; ctx.fillText(this.pendingIntervals ? `${this.pendingIntervals} source interval(s) pending finalization` : 'Waiting for recorded source intervals · no values are filled or interpolated',
          6 * dpr, (PANE_HEADER_HEIGHT + 16) * dpr, Math.max(0, rc.plotWidth * dpr - 12 * dpr));
      }
      ctx.restore(); return;
    }
    const bands = netPositioningBands(rc.plotHeight, this.showLongs, this.showShorts, this.reverseOrder,
      PANE_HEADER_HEIGHT + (health ? 16 : 5), 4);
    this.renderedBands = bands;
    if (!bands.length) {
      ctx.globalAlpha = .68; ctx.fillText('Both sides are hidden in settings', 6 * dpr, (PANE_HEADER_HEIGHT + 16) * dpr, Math.max(0, rc.plotWidth * dpr - 12 * dpr));
      ctx.restore(); return;
    }
    const bandScales = new Map<NetPositioningSide, number>();
    for (const band of bands) {
      const sideScale = this.visibleScale[band.side];
      const maxAbs = Math.max(Math.abs(sideScale.min), Math.abs(sideScale.max));
      const labelReserve = this.labels === 'off' ? 4 : Math.min(14, 4 + Math.max(0, this.venues.length - 1) * 3);
      bandScales.set(band.side, maxAbs > 0 ? Math.max(1, (band.bottom - band.top) / 2 - labelReserve) / maxAbs : 0);
      const y = roundDprBoundary(band.baseline, dpr), center = y + (baselineStrokeWidth % 2 ? .5 : 0);
      ctx.strokeStyle = rc.theme?.axisText ?? '#888'; ctx.globalAlpha = .32; ctx.lineWidth = baselineStrokeWidth;
      ctx.beginPath(); ctx.moveTo(0, center); ctx.lineTo(rc.plotWidth * dpr, center); ctx.stroke();
      const sourceColor = band.side === 'longs' ? '#75bd7b' : '#d17c7c';
      const maxText = maxAbs > 0 ? ` ±${formatScaleValue(maxAbs)} ${this.displayCurrencyLabel}` : '';
      ctx.font = `600 ${9 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textAlign = 'start'; ctx.textBaseline = 'top'; ctx.fillStyle = sourceColor; ctx.globalAlpha = .72;
      ctx.fillText(`${band.side === 'longs' ? 'LONGS' : 'SHORTS'}${maxText}`, 6 * dpr, (band.top + 2) * dpr, Math.max(0, rc.plotWidth * dpr - 12 * dpr));
    }
    if (bands.length > 1) {
      const divider = roundDprBoundary(bands[0]!.bottom, dpr);
      ctx.strokeStyle = rc.theme?.axisText ?? '#888'; ctx.globalAlpha = .2; ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath(); ctx.moveTo(0, divider); ctx.lineTo(rc.plotWidth * dpr, divider); ctx.stroke();
    }
    const amountLabels: { text: string; x: number; y: number; color: string; alpha: number; left: number; right: number; top: number; bottom: number }[] = [];
    for (let index = from; index < to; index++) {
      const timeMs = this.hostTimes[index]; if (timeMs === undefined) continue;
      const bar = this.candles.get(timeMs); if (!bar) continue;
      const x = rc.timeScale.indexToX(index);
      const column=this.columnGeometry(x,spacing,rc.dpr),groupWidth=Math.max(1/rc.dpr,column.width),centre=column.left+groupWidth/2;
      if (centre + groupWidth / 2 < 0 || centre - groupWidth / 2 > rc.plotWidth) continue;
      for (const band of bands) {
        const layout = layoutNetPositioningSources(this.sourceValues(bar, band.side), this.display);
        const scale = bandScales.get(band.side) ?? 0;
        const yForValue = (value: number) => band.baseline - value * scale;
        for (const segment of layout.segments) {
          if (segment.value === null || segment.start === null || segment.end === null) continue;
          const venue = segment.sourceId as NetPositioningVenue;
          const groupSlot = groupedSourceSlot(venue, this.venues, VENUE_ORDER, centre, groupWidth);
          const left = this.display === 'stacked' ? column.left : groupSlot?.left ?? column.left;
          const width = this.display === 'stacked' ? groupWidth : groupSlot?.width ?? groupWidth;
          const right = left + width;
          const yStart = yForValue(segment.start), yEnd = yForValue(segment.end);
          const topPx = Math.min(roundDprBoundary(yStart, dpr), roundDprBoundary(yEnd, dpr));
          const bottomPx = Math.max(roundDprBoundary(yStart, dpr), roundDprBoundary(yEnd, dpr));
          const baselinePx = roundDprBoundary(band.baseline, dpr);
          const baselineCenterPx = baselinePx + (baselineStrokeWidth % 2 ? .5 : 0);
          const zeroTopPx = baselineCenterPx - baselineStrokeWidth / 2;
          const leftPx = roundDprBoundary(left, dpr), rightPx = Math.max(leftPx + 1, roundDprBoundary(right, dpr));
          const segmentTopPx = segment.sign === 'zero' ? zeroTopPx : topPx;
          const segmentBottomPx = segment.sign === 'zero' ? zeroTopPx + baselineStrokeWidth : bottomPx;
          const hoverKey = `${band.side}:${venue}:${timeMs}`;
          const hovered = this.hovered?.side === band.side && this.hovered.sourceId === venue && this.hovered.timeMs === timeMs;
          const highlighted = this.highlightedSource ?? (rc.hoverKey?.startsWith('legend:') ? rc.hoverKey.slice('legend:'.length) as NetPositioningVenue : null);
          const dimmed = Boolean(highlighted && highlighted !== venue);
          const color = this.colors[band.side][venue];
          const partial = segment.quality === 'partial';
          ctx.fillStyle = color; ctx.globalAlpha = dimmed ? .2 : partial ? .62 : .9;
          if (segment.sign === 'zero') {
            ctx.globalAlpha = dimmed ? .25 : .95; ctx.fillRect(leftPx, zeroTopPx, rightPx - leftPx, baselineStrokeWidth);
          } else if (bottomPx > topPx) ctx.fillRect(leftPx, topPx, rightPx - leftPx, bottomPx - topPx);
          const top = segmentTopPx / dpr, bottom = segmentBottomPx / dpr;
          const geometry: SegmentGeometry = { side: band.side, sourceId: venue, timeMs, left:leftPx/dpr, top, right:rightPx/dpr, bottom, value: segment.value, quality: segment.quality, zero: segment.sign === 'zero' };
          this.geometry.push(geometry);
          const isHovered = hovered || rc.hoverKey === hoverKey;
          if (isHovered) {
            ctx.strokeStyle = rc.theme?.axisText ?? '#eee'; ctx.lineWidth = Math.max(1, dpr); ctx.globalAlpha = .9;
            const inset = Math.max(.5, dpr / 2); ctx.strokeRect(leftPx + inset, segmentTopPx + inset,
              Math.max(0, rightPx - leftPx - inset * 2), Math.max(0, segmentBottomPx - segmentTopPx - inset * 2));
          }
          const labelText = Math.round(Math.abs(segment.value)).toLocaleString('en-US');
          const labelVisible = this.labels === 'auto' ? true : this.labels === 'hover' && isHovered;
          if (labelVisible && segment.sign !== 'zero') {
            ctx.font = `600 ${12 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
            const metrics = ctx.measureText(labelText);
            const textHeight = Math.max(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent, 12 * dpr);
            const ascent = Math.max(metrics.actualBoundingBoxAscent, 9 * dpr), descent = Math.max(metrics.actualBoundingBoxDescent, 3 * dpr);
            const sameSide = layout.segments.filter(item => item.sign === segment.sign);
            const row = Math.max(0, sameSide.indexOf(segment));
            const edge = this.display === 'stacked'
              ? roundDprBoundary(yForValue(segment.sign === 'positive' ? layout.positiveTotal : layout.negativeTotal), dpr)
              : segment.sign === 'positive' ? topPx : bottomPx;
            const offset = 3 * dpr + row * (textHeight + 2 * dpr);
            const x = (leftPx + rightPx) / 2;
            const textLeft = x - metrics.width / 2, textRight = x + metrics.width / 2;
            const topLimit = (band.top + 15) * dpr;
            const bottomLimit = (band.bottom - 2) * dpr;
            const cellWidth = Math.max(spacing, groupWidth) * dpr;
            const cellLeft = centre * dpr - cellWidth / 2, cellRight = centre * dpr + cellWidth / 2;
            if (metrics.width <= cellWidth && textLeft >= Math.max(0, cellLeft) && textRight <= Math.min(rc.plotWidth * dpr, cellRight)
              && bottomLimit - topLimit >= ascent + descent) {
              const outsideY = segment.sign === 'positive' ? edge - offset - descent : edge + offset + ascent;
              const visibleTop = Math.max(topPx, topLimit), visibleBottom = Math.min(bottomPx, bottomLimit);
              const insideY = (visibleTop + visibleBottom) / 2 + (ascent - descent) / 2;
              const clampY = Math.max(topLimit + ascent, Math.min(bottomLimit - descent, outsideY));
              const rowStep = textHeight + 2 * dpr;
              const candidateYs = [outsideY];
              if (visibleBottom - visibleTop >= textHeight + 2 * dpr) candidateYs.push(insideY);
              candidateYs.push(clampY);
              for (let shift = 1; shift <= 3; shift++) candidateYs.push(clampY + rowStep * shift, clampY - rowStep * shift);
              const seenYs = new Set<number>();
              for (const candidateY of candidateYs) {
                if (seenYs.has(candidateY)) continue;
                seenYs.add(candidateY);
                const labelTop = candidateY - ascent, labelBottom = candidateY + descent;
                if (labelTop < topLimit || labelBottom > bottomLimit) continue;
                const overlaps = amountLabels.some(label => textLeft < label.right + 2 * dpr && textRight > label.left - 2 * dpr
                  && labelTop < label.bottom + 2 * dpr && labelBottom > label.top - 2 * dpr);
                if (overlaps) continue;
                const overBar = textLeft < rightPx && textRight > leftPx && labelTop < bottomPx && labelBottom > topPx;
                const labelBackground = rc.theme?.background ?? '#090909';
                const labelColor = overBar ? netPositioningTextColor(color, labelBackground) : netPositioningLabelColor(color, labelBackground);
                amountLabels.push({ text: labelText, x, y: candidateY, color: labelColor,
                  alpha: dimmed ? .4 : 1, left: textLeft, right: textRight, top: labelTop, bottom: labelBottom });
                break;
              }
            }
          }
          this.barsDrawn++;
        }
      }
    }
    // Paint after all bars so a later source cannot cover an earlier amount.
    ctx.font = `600 ${12 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const label of amountLabels) { ctx.fillStyle = label.color; ctx.globalAlpha = label.alpha; ctx.fillText(label.text, label.x, label.y); }
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
    this.hovered = { side: nearest.side, sourceId: nearest.sourceId, timeMs: nearest.timeMs };
    return { externalId: this.id, hoverKey: `${nearest.side}:${nearest.sourceId}:${nearest.timeMs}`, zOrder: 'normal' as const, distance };
  }
  hoverSummary(x: number, y: number) {
    const hit = this.geometry.find(item => x >= item.left - 2 && x <= item.right + 2 && y >= item.top - 2 && y <= item.bottom + 2);
    if (!hit) return null;
    const candle = this.candles.get(hit.timeMs);
    if (!candle) return null;
    const sources = this.sourceValues(candle, hit.side).map(source => ({ ...source, color: this.colors[hit.side][source.sourceId],
      label: source.sourceId === 'binance' ? 'Binance Perp' : source.sourceId === 'bybit' ? 'Bybit Perp' : 'Hyperliquid Perp' }));
    return { hoveredVenue: hit.sourceId, timeMs: hit.timeMs, intervalMs: this.intervalMs, side: hit.side, currency: this.currency, sources,
      total: sources.reduce((sum, source) => sum + (source.value ?? 0), 0),
      provisional: this.hostClosed.get(hit.timeMs) !== true, method: this.method,
      left: (hit.left + hit.right) / 2, top: hit.top, bottom: hit.bottom };
  }
  tooltip(timeMs: number) {
    const candle = this.candles.get(timeMs);
    if (!candle) return null;
    const closed = this.hostClosed.get(timeMs) === true;
    const title = 'Net Longs & Shorts';
    const method = this.method === 'price-oi' ? 'Price + OI' : 'Aggressor Flow + OI';
    const intervalLabel = `${this.intervalMs >= 3_600_000 ? `${this.intervalMs / 3_600_000}h` : this.intervalMs >= 60_000 ? `${this.intervalMs / 60_000}m` : `${this.intervalMs / 1000}s`} bar`;
    const lines = [`${title} · ${method} · ${this.display} · ${intervalLabel}`, new Date(timeMs).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC'), closed ? 'Confirmed host candle' : 'Provisional · host candle still forming'];
    for (const side of ['longs', 'shorts'] as const) {
      if (side === 'longs' && !this.showLongs || side === 'shorts' && !this.showShorts) continue;
      const layout = layoutNetPositioningSources(this.sourceValues(candle, side), this.display);
      lines.push(`${side === 'longs' ? 'Longs' : 'Shorts'} · ${this.display === 'stacked' ? 'Diverging stack' : 'Grouped'} · positive ${signed(String(layout.positiveTotal))} ${this.displayCurrencyLabel} · negative ${signed(String(layout.negativeTotal))} ${this.displayCurrencyLabel}`);
      const hovered = this.hovered?.side === side && this.hovered.timeMs === timeMs ? layout.segments.find(segment => segment.sourceId === this.hovered?.sourceId) : undefined;
      if (hovered) lines.push(`${venueLabel(hovered.sourceId as NetPositioningVenue)} ${side} segment · ${hovered.value === null ? hovered.quality : `${signed(String(hovered.value))} ${this.displayCurrencyLabel} · ${hovered.quality}`}`);
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
    const visibleMin = Math.min(this.visibleScale.longs.min, this.visibleScale.shorts.min);
    const visibleMax = Math.max(this.visibleScale.longs.max, this.visibleScale.shorts.max);
    return { currency: this.currency, mounted: Boolean(this.host), sides: ['longs', 'shorts'] as const, method: this.method, venues: [...this.venues],
      showLongs: this.showLongs, showShorts: this.showShorts, reverseOrder: this.reverseOrder, candleCount: this.candles.size,
      visibleDraws: this.drawCount, visibleBarsDrawn: this.barsDrawn, sourcePatches: this.patches, snapshots: this.snapshots,
      display: this.display, labels: this.labels, visibleScaleBars: this.hostTimes.slice(Math.max(0, Math.floor(this.visibleFrom)), Math.min(this.hostTimes.length, Math.ceil(this.visibleTo))).filter(time => this.candles.has(time)).length,
      renderedBands: this.renderedBands.map(band => ({ ...band })),
      visibleScaleBySide: { longs: { ...this.visibleScale.longs }, shorts: { ...this.visibleScale.shorts } },
      visibleScaleMinBtc: visibleMin, visibleScaleMaxBtc: visibleMax, maxAbsBtc: Math.max(Math.abs(visibleMin), Math.abs(visibleMax)),
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
function venueShort(venue: NetPositioningVenue) { return venue === 'binance' ? 'BN' : venue === 'bybit' ? 'BY' : 'HL'; }
function venueLabel(venue: NetPositioningVenue) { return venue === 'binance' ? 'Binance · BTCUSDT USD-M Perp' : venue === 'bybit' ? 'Bybit · BTCUSDT Perp' : 'Hyperliquid · BTC Perp'; }
function formatBtc(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.abs(number).toLocaleString('en-US', { minimumFractionDigits: number === 0 ? 0 : undefined, maximumFractionDigits: 8 }) : 'unavailable';
}
function formatScaleValue(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: Math.abs(value) >= 1 ? 4 : 8 });
}
function signed(value: string) { const number = Number(value); return Number.isFinite(number) ? `${number > 0 ? '+' : number < 0 ? '−' : ''}${formatBtc(value)}` : 'unavailable'; }
function formatBtcFromNumber(value: number) { return value.toLocaleString('en-US', { maximumFractionDigits: 8 }); }
function formatDuration(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return 'unknown';
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000}m`;
}
function utc(ms: number) { return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', '').replace('Z', ''); }
function price(value: number) { return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

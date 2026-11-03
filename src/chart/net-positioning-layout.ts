export type NetPositioningDisplay = 'stacked' | 'grouped';
export type NetPositioningQuality = 'complete' | 'partial' | 'unavailable' | 'missing';
export type NetPositioningBandSide = 'longs' | 'shorts';

export interface NetPositioningBand { side: NetPositioningBandSide; top: number; bottom: number; baseline: number }

/** Split the available pane height between visible sides in their configured order. */
export function netPositioningBands(plotHeight: number, showLongs: boolean, showShorts: boolean, reverseOrder = false,
  contentTop = 34, bottomPadding = 4): NetPositioningBand[] {
  const sides: NetPositioningBandSide[] = [
    ...(showLongs ? ['longs' as const] : []),
    ...(showShorts ? ['shorts' as const] : []),
  ];
  if (reverseOrder) sides.reverse();
  if (!sides.length || !Number.isFinite(plotHeight)) return [];
  const top = Math.max(0, Math.min(plotHeight, contentTop));
  const bottom = Math.max(top, plotHeight - Math.max(0, bottomPadding));
  const height = (bottom - top) / sides.length;
  return sides.map((side, index) => {
    const bandTop = top + index * height, bandBottom = index === sides.length - 1 ? bottom : top + (index + 1) * height;
    return { side, top: bandTop, bottom: bandBottom, baseline: (bandTop + bandBottom) / 2 };
  });
}

export interface NetPositioningSourceValue {
  /** Stable source identity, independent of its display order or label. */
  sourceId: string;
  value: number | null;
  quality?: NetPositioningQuality;
}

export interface NetPositioningSegment {
  sourceId: string;
  /** Original signed contribution. It is never split, abs-stacked, or rewritten. */
  value: number | null;
  start: number | null;
  end: number | null;
  sign: 'positive' | 'negative' | 'zero' | 'none';
  quality: NetPositioningQuality;
}

export interface NetPositioningLayout {
  display: NetPositioningDisplay;
  segments: NetPositioningSegment[];
  positiveTotal: number;
  negativeTotal: number;
  signedTotal: number;
}

/** Stable grouped placement. One selected source fills the column; all other
 * selected sources keep their registry slots even when a candle has no value. */
export function groupedSourceSlot(
  sourceId: string,
  selectedSourceIds: readonly string[],
  stableSourceOrder: readonly string[],
  centreX: number,
  fullWidth: number,
) {
  const width = Math.max(0, fullWidth);
  if (selectedSourceIds.length <= 1) return { left: centreX - width / 2, width };
  const slot = stableSourceOrder.indexOf(sourceId);
  if (slot < 0) return null;
  const gap = Math.min(1, width * .05);
  const slotWidth = Math.max(0, (width - gap * Math.max(0, stableSourceOrder.length - 1)) / Math.max(1, stableSourceOrder.length));
  return { left: centreX - width / 2 + slot * (slotWidth + gap), width: slotWidth };
}

/**
 * Pure diverging stack layout. Positive and negative contributions accumulate
 * independently around zero; the input order remains the stable source order.
 */
export function layoutNetPositioningSources(
  sources: readonly NetPositioningSourceValue[],
  display: NetPositioningDisplay,
): NetPositioningLayout {
  let positiveCursor = 0;
  let negativeCursor = 0;
  let positiveTotal = 0;
  let negativeTotal = 0;
  let signedTotal = 0;
  const segments = sources.map(source => {
    const valid = typeof source.value === 'number' && Number.isFinite(source.value);
    const value = valid ? source.value! : null;
    const quality: NetPositioningQuality = valid
      ? source.quality ?? 'complete'
      : source.value === null || source.value === undefined
        ? source.quality && source.quality !== 'complete' ? source.quality : 'missing'
        : 'unavailable';
    if (value === null) {
      return { sourceId: source.sourceId, value, start: null, end: null, sign: 'none' as const, quality };
    }
    signedTotal += value;
    if (value > 0) {
      positiveTotal += value;
      const start = display === 'stacked' ? positiveCursor : 0;
      const end = start + value;
      if (display === 'stacked') positiveCursor = end;
      return { sourceId: source.sourceId, value, start, end, sign: 'positive' as const, quality };
    }
    if (value < 0) {
      negativeTotal += value;
      const start = display === 'stacked' ? negativeCursor : 0;
      const end = start + value;
      if (display === 'stacked') negativeCursor = end;
      return { sourceId: source.sourceId, value, start, end, sign: 'negative' as const, quality };
    }
    return { sourceId: source.sourceId, value, start: 0, end: 0, sign: 'zero' as const, quality };
  });
  return { display, segments, positiveTotal, negativeTotal, signedTotal };
}

/** Round one shared data boundary to device pixels before filling adjacent bars. */
export function roundDprBoundary(cssCoordinate: number, dpr: number) {
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.round(cssCoordinate * safeDpr);
}

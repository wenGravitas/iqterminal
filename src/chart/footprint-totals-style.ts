import type { FootprintBarStats, FootprintStatRow } from 'openalgo-charts/profile';

export const FOOTPRINT_TOTALS_ROW_LABELS: Record<FootprintStatRow, string> = {
  volume: 'Total Volume',
  bidVolume: 'Total Bid Volume',
  askVolume: 'Total Ask Volume',
  delta: 'Delta',
  minDelta: 'Min Delta',
  maxDelta: 'Max Delta',
  deltaPct: 'Delta %',
  cvd: 'Cumulative Delta',
  trades: 'Trades',
};

export type FootprintTotalsRowColors = {
  background: string;
  axisText: string;
  buy: string;
  sell: string;
};

export function footprintTotalsCellColor(row: FootprintStatRow, value: number | null | undefined, maximum: number, colors: FootprintTotalsRowColors) {
  const finite = value != null && Number.isFinite(value) ? value : 0;
  const base = row === 'bidVolume' ? colors.sell
    : row === 'askVolume' ? colors.buy
    : row === 'volume' || row === 'trades' || finite === 0 ? colors.axisText
    : finite > 0 ? colors.buy : colors.sell;
  const strength = .1 + .4 * Math.min(1, Math.abs(finite) / Math.max(1, maximum));
  return blendFootprintTotalsColor(colors.background, base, strength);
}

export function blendFootprintTotalsColor(background: string, foreground: string, weight: number) {
  const bg = parseHex(background), fg = parseHex(foreground);
  if (!bg || !fg) return background;
  const amount = Math.max(0, Math.min(1, weight));
  const channel = (from: number, to: number) => Math.round(from + (to - from) * amount);
  return `rgb(${channel(bg[0], fg[0])}, ${channel(bg[1], fg[1])}, ${channel(bg[2], fg[2])})`;
}

export function footprintTotalsRowMax(stats: readonly FootprintBarStats[], row: FootprintStatRow) {
  let maximum = 1;
  for (const bar of stats) {
    const value = bar[row];
    if (value != null && Number.isFinite(value)) maximum = Math.max(maximum, Math.abs(value));
  }
  return maximum;
}

function parseHex(value: string): [number, number, number] | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1]!.length === 3 ? [...match[1]!].map(channel => channel + channel).join('') : match[1]!;
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

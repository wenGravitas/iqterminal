import { compactCvd, type CvdLine } from './cvd-model';

export function cvdLabelGutterWidth(plotWidth: number) {
  return Math.max(0, Math.min(148, Math.max(88, Math.floor(plotWidth / 4)), plotWidth - 80));
}

export function cvdEndLabels(lines: Iterable<CvdLine>, hidden: readonly string[], unit: string, height: number, priceToY: (value: number) => number) {
  const candidates = [...lines].filter(line => !hidden.includes(line.id)).flatMap(line => {
    const point = line.points.at(-1);
    if (point?.value == null || !Number.isFinite(point.value)) return [];
    const y = priceToY(point.value);
    if (!Number.isFinite(y)) return [];
    const name = line.id === 'binance:spot' ? 'BN[S]' : line.id === 'binance:perpetual' ? 'BN[P]' : line.id === 'bybit:perpetual' ? 'BY[P]' : line.name;
    return [{ id: line.id, name, fullName: line.name, value: point.value, text: `${compactCvd(point.value)} ${unit}${point.partial ? '*' : ''}`,
      direction: point.value > 0 ? 'up' : point.value < 0 ? 'down' : 'equal', time: point.time, partial: point.partial, y }];
  });
  const rows = candidates.slice(0, Math.max(0, Math.floor(height / 14))).sort((a, b) => a.y - b.y);
  let previous = -7;
  for (const row of rows) {
    row.y = Math.max(previous + 14, Math.max(7, Math.min(height - 7, row.y)));
    previous = row.y;
  }
  const shift = Math.max(0, (rows.at(-1)?.y ?? 0) - (height - 7));
  for (const row of rows) row.y -= shift;
  return { rows, omitted: candidates.length - rows.length };
}

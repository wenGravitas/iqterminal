import { DEPTH_MATRIX_SOURCE_REGISTRY, matrixBucketIndex, type DepthMatrixColumn, type DepthMatrixSettings, type MatrixRow } from './feed/depth-matrix';

export const MATRIX_ROW_HEIGHT = 28;
export const MATRIX_MIXED_ROW_HEIGHT = 36;
export const MATRIX_COLLAPSE_DELAY_MS = 1000;
export interface MatrixAnchor { index: string; offset: number }
export interface MatrixRowPosition { index: string; top: number; height: number }

/** The only pixel geometry for the shared axis, canvases and interactions. */
export class MatrixRowLayout {
  readonly positions: MatrixRowPosition[];
  readonly height: number;
  readonly signature: string;
  private byIndex: Map<string, MatrixRowPosition>;
  constructor(rows: readonly MatrixRow[], expanded: ReadonlySet<string> = new Set()) {
    let top = 0;
    this.positions = rows.map(row => {
      const height = expanded.has(row.index) ? MATRIX_MIXED_ROW_HEIGHT : MATRIX_ROW_HEIGHT;
      const position = { index: row.index, top, height }; top += height; return position;
    });
    this.height = top;
    this.byIndex = new Map(this.positions.map(row => [row.index, row]));
    this.signature = this.positions.map(row => `${row.index}:${row.height}`).join(',');
  }
  at(y: number) {
    if (y < 0 || y >= this.height) return -1;
    let low = 0, high = this.positions.length;
    while (low < high) { const mid = (low + high) >>> 1, row = this.positions[mid]!; if (row.top + row.height <= y) low = mid + 1; else high = mid; }
    return low;
  }
  visible(top: number, bottom: number): [number, number] {
    if (!this.positions.length || bottom <= 0 || top >= this.height) return [0, 0];
    return [Math.max(0, this.at(Math.max(0, top))), bottom >= this.height ? this.positions.length : Math.max(0, this.at(bottom - .001)) + 1];
  }
  anchor(y: number): MatrixAnchor | undefined {
    const row = this.positions[this.at(Math.max(0, Math.min(this.height - .001, y)))];
    return row ? { index: row.index, offset: y - row.top } : undefined;
  }
  offset(anchor: MatrixAnchor) { const row = this.byIndex.get(anchor.index); return row ? row.top + Math.min(anchor.offset, row.height - .001) : undefined; }
}

/** Bounded hysteresis: only current rows are retained, and cleared mixed rows expire. */
export class MatrixRowExpansion {
  private until = new Map<string, number>();
  nextExpiry?: number;
  layout(rows: readonly MatrixRow[], columns: readonly DepthMatrixColumn[], now: number) {
    const mixed = new Set(columns.filter(column => DEPTH_MATRIX_SOURCE_REGISTRY[column.source]?.supported)
      .flatMap(column => column.rows.filter(row => row.bidQuantity > 0 && row.askQuantity > 0).map(row => row.index)));
    const current = new Set(rows.map(row => row.index));
    for (const [index, expiry] of this.until) {
      if (!current.has(index)) this.until.delete(index);
      else if (!mixed.has(index)) {
        if (expiry === Infinity) this.until.set(index, now + MATRIX_COLLAPSE_DELAY_MS);
        else if (expiry <= now) this.until.delete(index);
      }
    }
    for (const index of mixed) if (current.has(index)) this.until.set(index, Infinity);
    this.nextExpiry = undefined;
    for (const expiry of this.until.values()) if (Number.isFinite(expiry)) this.nextExpiry = Math.min(this.nextExpiry ?? Infinity, expiry);
    return new MatrixRowLayout(rows, new Set(this.until.keys()));
  }
}

export function usableMatrixMid(column: DepthMatrixColumn | undefined) {
  return !!column && !!DEPTH_MATRIX_SOURCE_REGISTRY[column.source]?.supported && column.state === 'live'
    && column.mid !== null && Number.isFinite(Number(column.mid)) && Number(column.mid) > 0;
}
export function matrixCurrentBucket(column: DepthMatrixColumn | undefined, width: string) {
  return usableMatrixMid(column) ? matrixBucketIndex(column!.mid!, width) : null;
}
export function matrixSideWall(quantity: number, typical: number, settings: Pick<DepthMatrixSettings, 'wallMode' | 'wallThreshold'>) {
  return quantity > 0 && (settings.wallMode === 'absolute' ? quantity >= settings.wallThreshold
    : settings.wallMode === 'relative' && typical > 0 && quantity >= typical * settings.wallThreshold);
}

/** Group only the integer part; never round an exact decimal bucket or midpoint. */
export function matrixExactPrice(value: string) {
  const match = /^([+-]?\d+)(\.\d+)?$/.exec(value);
  return match ? match[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (match[2] ?? '') : value;
}
/** Preserve the canonical Number spelling, including tiny positive exponent values. */
export function matrixDetailValue(value: number, minimumDecimals: number, grouping = true) {
  const raw = String(value);
  if (raw.includes('e')) return raw;
  const [integer, fraction = ''] = raw.split('.');
  const whole = grouping ? matrixExactPrice(integer!) : integer!;
  return whole + (fraction || minimumDecimals ? '.' + fraction.padEnd(minimumDecimals, '0') : '');
}

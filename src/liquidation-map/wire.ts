import type { MapCell, MapColumn, MapPayload } from './model';
export interface MapWire {
    values: Float64Array;
    columns: Array<Omit<MapColumn, 'cells'> & {
        start: number;
        count: number;
    }>;
    identities: Array<Omit<MapCell, 'low' | 'high' | 'quantity' | 'nativePrice' | 'leverage'>>;
}
const STRIDE = 6;
/** Coalesced IPC keeps CPU prices/times in Float64 and transfers one buffer. */
export function packMap(payload: MapPayload): MapWire { const count = payload.columns.reduce((n, c) => n + c.cells.length, 0); if (count > 100000)
    throw Error('Map IPC cell capacity'); const values = new Float64Array(count * STRIDE), identities: MapWire['identities'] = [], dictionary = new Map<string, number>(); let cursor = 0; const columns = payload.columns.map(column => { const start = cursor; for (const c of column.cells) {
    const { low, high, quantity, nativePrice, leverage, ...identity } = c, key = JSON.stringify(identity);
    let index = dictionary.get(key);
    if (index === undefined) {
        index = identities.length;
        dictionary.set(key, index);
        identities.push(identity);
    }
    values.set([low, high, quantity, nativePrice, leverage ?? NaN, index], cursor * STRIDE);
    cursor++;
} const { cells, ...header } = column; return { ...header, start, count: cursor - start }; }); return { values, columns, identities }; }
export function unpackMap(header: MapPayload, wire: MapWire): MapPayload { if (!(wire.values instanceof Float64Array) || wire.values.length > 600000 || wire.values.length % STRIDE || wire.columns.length > 2048 || wire.identities.length > 10000)
    throw Error('Invalid map IPC bounds'); const columns = wire.columns.map(column => { if (!Number.isInteger(column.start) || !Number.isInteger(column.count) || column.start < 0 || column.count < 0 || (column.start + column.count) * STRIDE > wire.values.length)
    throw Error('Invalid map IPC column'); const cells: MapCell[] = []; for (let n = column.start; n < column.start + column.count; n++) {
    const i = n * STRIDE, [low, high, quantity, nativePrice, leverage, index] = wire.values.subarray(i, i + STRIDE), identity = wire.identities[index];
    if (!identity || ![low, high, quantity, nativePrice].every(Number.isFinite) || high <= low || quantity < 0 || nativePrice <= 0)
        throw Error('Invalid map IPC cell');
    cells.push({ ...identity, low, high, quantity, nativePrice, leverage: Number.isNaN(leverage) ? null : leverage });
} const { start, count, ...metadata } = column; return { ...metadata, cells }; }); return { ...header, columns }; }

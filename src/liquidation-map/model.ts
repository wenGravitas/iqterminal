export const LIQUIDATION_MAP_ID = 'native.liquidation-map';
export const MAP_VENUES = ['hyperliquid', 'lighter', 'binance', 'bybit', 'coinbase'] as const;
export type MapVenue = typeof MAP_VENUES[number];
export interface MapSettings {
    venues: MapVenue[];
    longs: boolean;
    shorts: boolean;
    observed: boolean;
    estimated: boolean;
    leverage: number[];
    includeUnknownLeverage: boolean;
    priceWidth: number;
    resolution: number;
    lookback: number;
    minimum: number;
    opacity: number;
    intensity: number;
    fixedMaximum: number;
    profile: boolean;
    profileCrosshair: boolean;
    units: 'BTC' | 'native-quote';
    labels: boolean;
}
const n = (v: unknown, f: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : f;
export function mapSettings(value: unknown): MapSettings { const r = value && typeof value === 'object' ? value as Partial<MapSettings> : {}; return { venues: MAP_VENUES.filter(v => (Array.isArray(r.venues) ? r.venues : ['hyperliquid', 'lighter', 'binance', 'bybit']).includes(v)), longs: r.longs !== false, shorts: r.shorts !== false, observed: r.observed !== false, estimated: r.estimated !== false, leverage: [3, 5, 10, 25, 50, 100].filter(l => (Array.isArray(r.leverage) ? r.leverage : [3, 5, 10, 25, 50, 100]).includes(l)), includeUnknownLeverage: r.includeUnknownLeverage !== false, priceWidth: n(r.priceWidth, 100, 1, 10000), resolution: Math.round(n(r.resolution, 60000, 10000, 3600000)), lookback: n(r.lookback, 4 * 3600000, 60000, 7 * 86400000), minimum: n(r.minimum, .01, 0, 1e9), opacity: n(r.opacity, .6, .05, 1), intensity: n(r.intensity, 1, .1, 10), fixedMaximum: n(r.fixedMaximum, 0, 0, 1e12), profile: r.profile !== false, profileCrosshair: r.profileCrosshair === true, units: r.units === 'native-quote' ? 'native-quote' : 'BTC', labels: r.labels === true }; }
export interface MapCell {
    low: number;
    high: number;
    quantity: number;
    side: 'long' | 'short';
    venue: MapVenue;
    kind: 'observed' | 'estimated';
    scenario: string;
    leverage: number | null;
    quote: string;
    nativePrice: number;
    quoteVerified?:boolean;
    modelVersion: string;
    riskVersion: string;
}
export interface MapColumn {
    at: number;
    availableAt: number;
    revision: number;
    cells: MapCell[];
    quality: string[];
    sources?: MapSourceStatus[];
    scenarioCatalog?: Array<{
        venue: MapVenue;
        id: string;
        leverage: number;
    }>;
}
export interface MapSourceStatus {
    venue: MapVenue;
    state: string;
    message: string;
    asOf: number | null;
    accounts: number;
    freshQuantity: number;
    staleQuantity: number;
    locatedQuantity: number;
    oi: number | null;
    coverageProxy: number | null;
    locatedCoverageProxy?: number | null;
    longCoverageProxy?: number | null;
    shortCoverageProxy?: number | null;
    unknownQuantity: number;
    quote: string;
}
export interface MapPayload {
    version: 1;
    columns: MapColumn[];
    sources: MapSourceStatus[];
    head: number;
    next: number | null;
    from: number;
    to: number;
    resolution: number;
    priceWidth: number;
    semantics: 'conditional-exposure';
    asOf: number;
    acquisition?: {workerElapsedMs:number;requests:number;headersMs:number;bodyMs:number;decodeMs:number;bytes:number;cache:'warm'|'network';serverTimings?:string[]};
}
export type MapCommand = {
    type: 'liquidation-map-subscribe' | 'liquidation-map-update';
    id: string;
    from: number;
    to: number;
    settings: MapSettings;
} | {
    type: 'liquidation-map-unsubscribe' | 'liquidation-map-ack';
    id: string;
};
export type MapBatch = {
    type: 'liquidation-map-batch';
    ids: string[];
    payload?: MapPayload;
    wire?: import('./wire').MapWire;
    error?: string;
};

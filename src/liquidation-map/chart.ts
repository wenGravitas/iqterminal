import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { mapSettings, mapColumnAt, type MapColumn, type MapSettings, type MapCell } from './model';
export function selectedCells(column: MapColumn, settings: MapSettings, quote: string) { return column.cells.filter(c => settings.venues.includes(c.venue) && (c.side === 'long' ? settings.longs : settings.shorts) && (c.kind === 'observed' ? settings.observed : settings.estimated) && (c.leverage === null ? settings.includeUnknownLeverage : settings.leverage.includes(c.leverage)) && (settings.units === 'BTC' || c.quote === quote&&c.quoteVerified!==false&&(c.venue!=='lighter'||c.quoteVerified===true))); }
/** Alternative scenarios are averaged, never added as independent stock.
 * Leverage choices carry an equal explicit prior; turnover cases are alternatives. */
export function exposureRows(column: MapColumn, settings: MapSettings, quote: string) {
    const cells = selectedCells(column, settings, quote), rows = new Map<number, number>();
    const alternatives = new Map<string, Set<string>>();
    for (const item of column.scenarioCatalog ?? [])
        if (settings.venues.includes(item.venue) && settings.leverage.includes(item.leverage)) {
            let set = alternatives.get(item.venue);
            if (!set)
                alternatives.set(item.venue, set = new Set());
            set.add(item.id);
        }
    for (const c of column.cells)
        if (c.kind === 'estimated' && settings.venues.includes(c.venue) && c.leverage !== null && settings.leverage.includes(c.leverage)) {
            const key = c.venue;
            let set = alternatives.get(key);
            if (!set)
                alternatives.set(key, set = new Set());
            set.add(c.scenario);
        }
    for (const c of cells) {
        const divisor = c.kind === 'estimated' ? Math.max(1, alternatives.get(c.venue)?.size ?? 1) : 1;
        const amount = c.quantity / divisor * (settings.units === 'BTC' ? 1 : c.nativePrice);
        rows.set(c.low, (rows.get(c.low) ?? 0) + amount);
    }
    return rows;
}
export function exposureSummary(column: MapColumn, settings: MapSettings, quote: string, low = -Infinity, high = Infinity) {
    const rows = exposureRows(column, settings, quote);
    let mean = 0;
    for (const [price, value] of rows)
        if (price >= low && price < high)
            mean += value;
    const cells = selectedCells(column, settings, quote).filter(c => c.low >= low && c.low < high), observed = cells.filter(c => c.kind === 'observed').reduce((n, c) => n + c.quantity * (settings.units === 'BTC' ? 1 : c.nativePrice), 0);
    const totals = new Map<string, number>();
    for (const item of column.scenarioCatalog ?? [])
        if (settings.venues.includes(item.venue) && settings.leverage.includes(item.leverage))
            totals.set(item.id, observed);
    for (const c of cells)
        if (c.kind === 'estimated')
            totals.set(c.scenario, (totals.get(c.scenario) ?? observed) + c.quantity * (settings.units === 'BTC' ? 1 : c.nativePrice));
    const values = totals.size ? [...totals.values()] : [observed];
    return { mean, minimum: Math.min(...values), maximum: Math.max(...values), dependence: 'shared-scenario-index across venues', label: 'uncalibrated model-scenario range' };
}
export function spectrum(t: number) { const stops = [[0, 205, 245], [0, 225, 145], [225, 235, 20], [245, 45, 20]], v = Math.max(0, Math.min(.999, t)) * 3, i = Math.floor(v), f = v - i; return `rgb(${stops[i].map((x, k) => Math.round(x + (stops[i + 1][k] - x) * f)).join(',')})`; }
const PALETTE = Array.from({ length: 128 }, (_, i) => spectrum(i / 127));
export class LiquidationMapPrimitive implements IPrimitive {
    private geometry?: {
        key: string;
        columns: MapColumn[];
        paths: Map<number, Path2D>;
        anchor: number;
        anchorX: number;
        count: number;
    };
    private rowsCache = new WeakMap<MapColumn, {
        key: string;
        rows: Map<number, number>;
    }>();
    private host?: PrimitiveHost;
    columns: MapColumn[] = [];
    settings = mapSettings(undefined);
    quote = 'USDT';
    visible = true;
    displayPriceWidth = 100;
    profileTime: number | null = null;
    readonly metrics = { draws: 0, lastMs: 0, maxMs: 0, cells: 0 };
    zOrder() { return 'bottom' as const; }
    autoscaleInfo() { return null; }
    attached(host: PrimitiveHost) { this.host = host; }
    detached() { this.host = undefined; }
    update() { this.host?.requestUpdate(); }
    draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
        if (!this.visible || !rc.dataLayer.length)
            return;
        const started = performance.now(), s = this.settings, d = rc.dpr;
        const range = rc.timeScale.visibleRange(), from = rc.dataLayer.indexToTimeFloat(range.from) * 1000, to = rc.dataLayer.indexToTimeFloat(range.to) * 1000;
        const priceRange = rc.priceScale.priceRange();
        const rowPixels = Math.abs(rc.priceScale.priceToY(priceRange.min + s.priceWidth) - rc.priceScale.priceToY(priceRange.min));
        const factor = Number.isFinite(rowPixels) && rowPixels > 0 ? Math.max(1, 2 ** Math.ceil(Math.log2(2 / rowPixels))) : 1;
        const displayWidth = s.priceWidth * factor;
        this.displayPriceWidth = displayWidth;
        const visible = this.columns.filter(c => c.availableAt < to && c.availableAt + s.resolution >= from);
        const key = JSON.stringify([s.venues, s.longs, s.shorts, s.observed, s.estimated, s.leverage, s.includeUnknownLeverage, s.units, this.quote, displayWidth]);
        const bins = (column: MapColumn) => { const cached = this.rowsCache.get(column); if (cached?.key === key)
            return cached.rows; const raw = exposureRows(column, s, this.quote), rows = new Map<number, number>(); for (const [price, amount] of raw) {
            const low = Math.floor(price / displayWidth) * displayWidth;
            rows.set(low, (rows.get(low) ?? 0) + amount);
        } this.rowsCache.set(column, { key, rows }); return rows; };
        let maximum = s.fixedMaximum;
        if (!maximum)
            for (const c of visible)
                for (const amount of bins(c).values())
                    maximum = Math.max(maximum, amount);
        maximum = Math.max(maximum, 1e-12);
        const profileColumn = mapColumnAt(this.columns, this.profileTime ?? Infinity), profile = profileColumn ? bins(profileColumn) : new Map<number, number>();
        const profileMax = Math.max(1e-12, ...profile.values());
        const anchor = this.columns[0]?.availableAt ?? 0, anchorX = rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(anchor / 1000));
        const geometryKey = JSON.stringify([key, s.priceWidth, s.resolution, s.minimum, s.intensity, maximum, s.labels, rc.timeScale.barSpacing, priceRange, rc.plotWidth, rc.plotHeight, d, rc.dataLayer.length, rc.dataLayer.indexToTimeFloat(0), rc.dataLayer.indexToTimeFloat(rc.dataLayer.length - 1)]);
        const cached = !s.labels && this.geometry?.key === geometryKey && this.geometry.columns === this.columns ? this.geometry : undefined;
        let count = cached?.count ?? 0;
        const paths = cached?.paths ?? new Map<number, Path2D>(), labels: Array<{
            x: number;
            y: number;
            text: string;
            colour: string;
        }> = [];
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, rc.plotWidth * d, rc.plotHeight * d);
        ctx.clip();
        ctx.globalAlpha = s.opacity;
        if (!cached)
            for (let index = 0; index < this.columns.length; index++) {
                const c = this.columns[index];
                const end = Math.min(c.availableAt + s.resolution, this.columns[index + 1]?.availableAt ?? Infinity);
                const x = rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(c.availableAt / 1000)), right = rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(end / 1000));
                for (const [price, amount] of bins(c)) {
                    if (amount < s.minimum)
                        continue;
                    const y = rc.priceScale.priceToY(price + displayWidth), bottom = rc.priceScale.priceToY(price);
                    if (bottom < 0 || y > rc.plotHeight)
                        continue;
                    const colour = Math.max(0, Math.min(127, Math.floor(amount / maximum * s.intensity * 127)));
                    let path = paths.get(colour);
                    if (!path)
                        paths.set(colour, path = new Path2D());
                    path.rect(x * d, y * d, Math.max(1, right - x - (right - x > 4 ? 1 : 0)) * d, Math.max(1, bottom - y - 1) * d);
                    if (s.labels && right - x > 48 && bottom - y > 14)
                        labels.push({ x: (Math.max(0, x) + 2) * d, y: (y + 11) * d, text: amount.toPrecision(2), colour: amount / maximum * s.intensity > .85 ? '#fff' : '#090909' });
                    count++;
                }
            }
        if (!cached && !s.labels)
            this.geometry = { key: geometryKey, columns: this.columns, paths, anchor, anchorX, count };
        ctx.save();
        if (cached)
            ctx.translate((anchorX - cached.anchorX) * d, 0);
        for (const [colour, path] of paths) {
            ctx.fillStyle = PALETTE[colour];
            ctx.fill(path);
        }
        ctx.restore();
        ctx.font = `${9 * d}px monospace`;
        ctx.textAlign = 'left';
        for (const label of labels) {
            ctx.fillStyle = label.colour;
            ctx.fillText(label.text, label.x, label.y);
        }
        if (s.profile) {
            ctx.globalAlpha = .85;
            ctx.fillStyle = rc.theme.axisText;
            ctx.font = `${9 * d}px monospace`;
            ctx.textAlign = 'right';
            if (profileColumn)
                ctx.fillText(`${new Date(profileColumn.availableAt).toISOString().slice(11, 19)} · ${s.units === 'BTC' ? 'BTC' : this.quote}`, rc.plotWidth * d, 12 * d);
            ctx.globalAlpha = s.opacity;
            for (const [price, amount] of profile) {
                if (amount < s.minimum)
                    continue;
                const y = rc.priceScale.priceToY(price + displayWidth), bottom = rc.priceScale.priceToY(price);
                ctx.fillStyle = PALETTE[Math.max(0, Math.min(127, Math.floor(amount / maximum * s.intensity * 127)))];
                const width = Math.min(100, rc.plotWidth * .2) * amount / profileMax;
                ctx.fillRect((rc.plotWidth - width) * d, y * d, width * d, Math.max(1, bottom - y - 1) * d);
            }
        }
        ctx.restore();
        this.metrics.draws++;
        this.metrics.cells = count;
        this.metrics.lastMs = performance.now() - started;
        this.metrics.maxMs = Math.max(this.metrics.maxMs, this.metrics.lastMs);
    }
}

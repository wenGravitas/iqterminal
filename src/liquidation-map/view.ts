import type { Chart } from 'openalgo-charts';
import type { FeedClient } from '../feed/client';
import type { Series } from '../feed/protocol';
import { instrumentOf } from '../feed/protocol';
import { mapSettings, mapColumnAt, type MapSettings, type MapPayload } from './model';
import { LiquidationMapPrimitive, selectedCells, exposureSummary } from './chart';
import { MapControls } from './controls';
export class LiquidationMapView {
    private primitive = new LiquidationMapPrimitive();
    private controls: MapControls;
    private status = document.createElement('div');
    private tooltip = document.createElement('div');
    private settings = mapSettings(undefined);
    private series: Series;
    private subscription?: ReturnType<FeedClient['subscribeLiquidationMap']>;
    private releases: Array<() => void> = [];
    private timer?: ReturnType<typeof setTimeout>;
    private dead = false;
    private shown = true;
    private payload?: MapPayload;
    constructor(private host: HTMLElement, private chart: Chart, private feed: FeedClient, series: Series, change: (s: MapSettings) => void, private owner: string) { this.series = series; this.controls = new MapControls(host.closest<HTMLElement>('.candle-panel') ?? host, change); this.status.className = 'liquidation-map-status'; Object.assign(this.status.style, { position: 'absolute', left: '6px', bottom: '24px', maxWidth: '90%', fontSize: '10px', color: 'var(--muted)', pointerEvents: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }); this.tooltip.className = 'positioning-tooltip'; this.tooltip.hidden = true; host.append(this.status, this.tooltip); chart.addPrimitive(this.primitive); this.releases.push(chart.on('visibleRangeChange', () => this.viewport()), chart.subscribeCrosshairMove(e => { if (!e.point || e.time == null) {
        this.tooltip.hidden = true;
        return;
    } if (!this.shown) return;
    const at = e.time * 1000, plot = chart.plotRect(chart.primaryPaneIndex());
    if (!plot) return;
    const inspectProfile = this.settings.profile && e.point.x >= plot.left + plot.width - Math.min(100, plot.width * .2);
    const inspectionAt = inspectProfile && !this.settings.profileCrosshair ? Infinity : at;
    const column = mapColumnAt(this.primitive.columns, inspectionAt); if (this.settings.profileCrosshair) {
        this.primitive.profileTime = at;
        this.primitive.update();
    } if (!column || !inspectProfile && column.availableAt + this.settings.resolution < at) {
        this.tooltip.hidden = true;
        return;
    } const price = chart.panes()[chart.primaryPaneIndex()]!.yToPrice(e.point.y - plot.top); const displayWidth = this.primitive.displayPriceWidth, low = Math.floor(price / displayWidth) * displayWidth, high = low + displayWidth; const cells = selectedCells(column, this.settings, this.primitive.quote).filter(c => c.low >= low && c.low < high); if (!cells.length) {
        this.tooltip.hidden = true;
        return;
    } const summary = exposureSummary(column, this.settings, this.primitive.quote, low, high); if(summary.mean<this.settings.minimum){this.tooltip.hidden=true;return;} this.tooltip.textContent = `${inspectProfile ? 'Profile snapshot · ' : ''}Mean ${summary.mean.toPrecision(3)} · model-scenario range ${summary.minimum.toPrecision(3)}–${summary.maximum.toPrecision(3)} · shared scenario index across venues\n${new Date(column.availableAt).toISOString()} · ${low}–${high} native price (screen LOD)\n` + cells.map(c => `${c.venue} ${c.side} ${c.kind} ${(c.quantity * (this.settings.units === 'BTC' ? 1 : c.nativePrice)).toPrecision(3)} ${this.settings.units === 'BTC' ? 'BTC' : c.quote} · ${c.scenario} · threshold ${c.nativePrice.toPrecision(6)} ${c.quote} · risk ${c.riskVersion}`).join('\n') + `\nAge ${Math.max(0, Math.round((Date.now() - column.availableAt) / 1000))}s · ${column.quality.join(', ')}\n${(column.sources ?? []).filter(s => this.settings.venues.includes(s.venue)).map(s => `${s.venue}: ${s.state}, ${s.accounts} accounts, coverage ${s.coverageProxy === null ? 'unverified' : (s.coverageProxy * 100).toPrecision(2) + '% proxy'}`).join(' · ')}`; this.tooltip.style.whiteSpace = 'pre-line'; this.tooltip.style.left = `${Math.max(4, Math.min(host.clientWidth - 320, e.point.x + 12))}px`; this.tooltip.style.top = `${Math.max(4, Math.min(host.clientHeight - 120, e.point.y + 12))}px`; this.tooltip.hidden = false; })); }
    configure(value: unknown, series: Series) { this.series = series; if (series.market === 'spot' || instrumentOf(series).base !== 'BTC') {
        this.subscription?.dispose();
        this.subscription = undefined;
        this.primitive.columns = [];
        this.payload = undefined;
        this.status.textContent = 'Liquidation Map requires BTC perpetuals';
        this.primitive.update();
        return;
    } this.settings = mapSettings(value); if (!this.settings.profileCrosshair)
        this.primitive.profileTime = null; this.primitive.settings = { ...this.settings, priceWidth: this.payload?.priceWidth ?? this.settings.priceWidth, resolution: this.payload?.resolution ?? this.settings.resolution }; this.primitive.quote = instrumentOf(series).quote; this.viewport(); this.primitive.update(); }
    private viewport() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            if (this.dead || !this.shown)
                return;
            const info = instrumentOf(this.series);
            if (info.base !== 'BTC' || this.series.market === 'spot') {
                this.status.textContent = 'Liquidation Map requires BTC perpetuals';
                return;
            }
            const range = this.chart.getVisibleLogicalRange(), now = Date.now(), from = range ? this.chart.dataLayer.indexToTimeFloat(range.from) * 1000 : now - this.settings.lookback, to = range ? this.chart.dataLayer.indexToTimeFloat(range.to) * 1000 : now;
            const end = Number.isFinite(to) ? Math.min(now + this.settings.resolution, to) : now, start = Number.isFinite(from) ? Math.max(0, from) : end - this.settings.lookback;
            if (!this.subscription)
                this.subscription = this.feed.subscribeLiquidationMap(this.owner, start, end, this.settings, batch => { if (this.dead)
                    return; if (batch.error) {
                    this.status.textContent = batch.error + ' · retained map';
                    return;
                } if (!batch.payload)
                    return; const gridChanged = this.payload && (this.payload.priceWidth !== batch.payload.priceWidth || this.payload.resolution !== batch.payload.resolution); this.payload = batch.payload; this.primitive.settings = { ...this.settings, priceWidth: batch.payload.priceWidth, resolution: batch.payload.resolution }; const retained = new Map((gridChanged ? [] : this.primitive.columns).map(c => [c.availableAt, c])); for (const c of batch.payload.columns) {
                    const old = retained.get(c.availableAt);
                    if (!old || c.revision >= old.revision)
                        retained.set(c.availableAt, c);
                } this.primitive.columns = [...retained.values()].sort((a, b) => a.availableAt - b.availableAt).slice(-2048); this.controls.sources = batch.payload.sources; this.status.textContent = `${batch.payload.resolution / 1000}s as-of cells · Native USD/USDT/USDC prices; no FX/basis conversion · ` + batch.payload.sources.filter(s => this.settings.venues.includes(s.venue)).map(s => `${s.venue}: ${s.state}${s.asOf ? ' ' + Math.max(0, Math.round((Date.now() - s.asOf) / 1000)) + 's' : ''}`).join(' · '); this.status.title = batch.payload.sources.map(s => `${s.venue}: ${s.message}`).join('\n'); this.primitive.update(); });
            else
                this.subscription.update(start, end, this.settings);
        }, 150);
    }
    setVisible(value: boolean) { if (this.shown === value)
        return; this.shown = value; this.primitive.visible = value; this.status.hidden = !value; if (!value) {
        this.tooltip.hidden = true;
    }
    else
        this.viewport(); this.primitive.update(); }
    openSettings() { this.controls.open(this.settings); }
    diagnostics() { return { ...this.primitive.metrics, columns: this.primitive.columns.length, sources: this.payload?.sources, acquisition:this.payload?.acquisition }; }
    dispose() { this.dead = true; clearTimeout(this.timer); this.subscription?.dispose(); for (const release of this.releases)
        release(); this.chart.removePrimitive(this.primitive); this.controls.dispose(); this.status.remove(); this.tooltip.remove(); }
}

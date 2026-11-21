import type { Chart } from 'openalgo-charts';
import type { FeedClient } from '../feed/client';
import type { Series } from '../feed/protocol';
import { instrumentOf } from '../feed/protocol';
import { mapSettings, mapColumnAt, freshProfile, mapColumnEnd, type MapSettings, type MapPayload } from './model';
import { LiquidationMapPrimitive, selectedCells, exposureSummary } from './chart';
import {renderMapTooltip} from './tooltip';
import { MapControls } from './controls';
export class LiquidationMapView {
    private primitive = new LiquidationMapPrimitive();
    private controls: MapControls;
    private status = document.createElement('div');
    private tooltip = document.createElement('div');
    private tooltipKey='';
    private settings = mapSettings(undefined);
    private series: Series;
    private subscription?: ReturnType<FeedClient['subscribeLiquidationMap']>;
    private releases: Array<() => void> = [];
    private timer?: ReturnType<typeof setTimeout>;
    private dead = false;
    private shown = true;
    private payload?: MapPayload;
    constructor(private host: HTMLElement, private chart: Chart, private feed: FeedClient, series: Series, change: (s: MapSettings) => void, private owner: string) { this.series = series; this.controls = new MapControls(host.closest<HTMLElement>('.candle-panel') ?? host, change); this.status.className = 'liquidation-map-status'; Object.assign(this.status.style, { position: 'absolute', left: '6px', top: '6px', maxWidth: '90%', fontSize: '10px', color: 'var(--muted)', zIndex: '4', background: 'var(--overlay)', padding: '1px 3px', pointerEvents: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }); this.tooltip.className = 'net-positioning-tooltip positioning-tooltip liquidation-map-tooltip';this.tooltip.setAttribute('role','tooltip'); this.tooltip.hidden = true; this.status.textContent='Loading Liquidation Map…';this.status.setAttribute('role','status');host.append(this.status, this.tooltip); chart.addPrimitive(this.primitive); this.releases.push(chart.on('resize',()=>this.placeStatus()),chart.on('paneResized',()=>this.placeStatus()),chart.on('paneMoved',()=>this.placeStatus()),chart.on('visibleRangeChange', () => this.viewport()), chart.subscribeCrosshairMove(e => { if (!e.point) {
        this.tooltip.hidden = true;
        return;
    } if (!this.shown) return;
    const plot = chart.plotRect(chart.primaryPaneIndex());
    if (!plot || !chart.dataLayer.length) return;
    if(e.point.x<plot.left||e.point.x>plot.left+plot.width||e.point.y<plot.top||e.point.y>plot.top+plot.height){this.tooltip.hidden=true;return;}
    const at = chart.dataLayer.indexToTimeFloat(chart.timeScale.xToIndex(e.point.x-plot.left))*1000;
    const inspectProfile = this.settings.profile && e.point.x >= plot.left + plot.width - Math.min(100, plot.width * .2);
    const inspectionAt = inspectProfile && !this.settings.profileCrosshair ? Infinity : at;
    const column = inspectionAt===Infinity?freshProfile(this.primitive.profile??mapColumnAt(this.primitive.columns,Infinity)):mapColumnAt(this.primitive.columns,inspectionAt); if (this.settings.profileCrosshair) {
        this.primitive.profileTime = at;
        this.primitive.update();
    } if (!column || !inspectProfile && mapColumnEnd(column,undefined,this.primitive.settings.resolution) < at) {
        this.tooltip.hidden = true;
        return;
    } const price = chart.panes()[chart.primaryPaneIndex()]!.yToPrice(e.point.y - plot.top); const displayWidth = this.primitive.displayPriceWidth, low = Math.floor(price / displayWidth) * displayWidth, high = low + displayWidth; const cells = selectedCells(column, this.settings, this.primitive.quote).filter(c => c.low >= low && c.low < high); if (!cells.length) {
        this.tooltip.hidden = true;
        return;
    } const summary = exposureSummary(column, this.settings, this.primitive.quote, low, high); if(summary.mean<this.settings.minimum){this.tooltip.hidden=true;return;} const tooltipKey=`${column.availableAt}:${column.revision}:${low}:${high}:${inspectProfile}:${Math.floor(Date.now()/1000)}`;
    if(tooltipKey!==this.tooltipKey){renderMapTooltip(this.tooltip,{column,cells,settings:{...this.settings,priceWidth:this.primitive.settings.priceWidth},quote:this.primitive.quote,low,high,profile:inspectProfile});this.tooltipKey=tooltipKey;}
    this.tooltip.style.maxWidth=`${Math.max(0,plot.width-8)}px`;this.tooltip.style.maxHeight=`${Math.max(0,plot.height-8)}px`;this.tooltip.style.overflow='hidden';this.tooltip.hidden=false;
    const width=this.tooltip.offsetWidth,height=this.tooltip.offsetHeight;
    const right=plot.left+plot.width,bottom=plot.top+plot.height;
    const x=e.point.x+12+width<=right-4?e.point.x+12:e.point.x-width-12;
    const above=e.point.y-height-10,below=e.point.y+12;
    const y=above>=plot.top+4?above:below+height<=bottom-4?below:e.point.y-height/2;
    this.tooltip.style.left=`${Math.max(plot.left+4,Math.min(right-width-4,x))}px`;
    this.tooltip.style.top=`${Math.max(plot.top+4,Math.min(bottom-height-4,y))}px`;
     })); }
    configure(value: unknown, series: Series) { this.tooltipKey='';this.tooltip.hidden=true;this.series = series; if (series.market === 'spot' || instrumentOf(series).base !== 'BTC') {
        this.subscription?.dispose();
        this.subscription = undefined;
        this.primitive.columns = [];this.primitive.profile=undefined;
        this.payload = undefined;
        this.status.textContent = 'Liquidation Map requires BTC perpetuals';
        this.primitive.update();
        return;
    } this.settings = mapSettings(value); if (!this.settings.profileCrosshair)
        this.primitive.profileTime = null; this.primitive.settings = { ...this.settings, priceWidth: this.payload?.priceWidth ?? this.settings.priceWidth, resolution: this.payload?.resolution ?? this.settings.resolution }; this.primitive.quote = instrumentOf(series).quote; this.viewport(); this.primitive.update(); }
    private placeStatus() {
        const plot=this.chart.plotRect(this.chart.primaryPaneIndex());if(!plot)return;
        this.status.style.left=`${plot.left+6}px`;this.status.style.top=`${plot.top+Math.max(0,plot.height-18)}px`;
        this.status.style.maxWidth=`${Math.max(0,plot.width-12)}px`;this.tooltip.hidden=true;
    }
    private viewport() {
        this.placeStatus();
        this.tooltip.hidden=true;
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
            if (!this.subscription){
                this.status.textContent='Loading Liquidation Map history…';
                this.subscription = this.feed.subscribeLiquidationMap(this.owner, start, end, this.settings, batch => { if (this.dead)
                    return; if (batch.error) {
                    this.status.textContent = batch.error + (this.primitive.columns.length?' · keeping loaded map':' · no map loaded; retrying');
                    return;
                } if (!batch.payload)
                    return; const generationChanged = this.payload && (this.payload.generation??0)!==(batch.payload.generation??0); const gridChanged = this.payload && (this.payload.priceWidth !== batch.payload.priceWidth); this.payload = batch.payload;this.primitive.profile=batch.payload.profile; this.primitive.settings = { ...this.settings, priceWidth: batch.payload.priceWidth, resolution: batch.payload.resolution }; const retained = new Map((gridChanged || generationChanged ? [] : this.primitive.columns).map(c => [c.availableAt, c])); for (const c of batch.payload.columns) {
                    const old = retained.get(c.availableAt);
                    if (!old || c.revision >= old.revision)
                        retained.set(c.availableAt, {...c,resolution:batch.payload.resolution});
                } this.primitive.columns = [...retained.values()].sort((a, b) => a.availableAt - b.availableAt).slice(-2048); this.controls.sources = batch.payload.sources; this.status.textContent = `${batch.payload.resolution / 1000}s as-of cells · Visible-price auto / fixed scale in settings · Native USD/USDT/USDC prices; no FX/basis conversion · ` + batch.payload.sources.filter(s => this.settings.venues.includes(s.venue)).map(s => `${s.venue}: ${s.state}${s.asOf ? ' ' + Math.max(0, Math.round((Date.now() - s.asOf) / 1000)) + 's' : ''}`).join(' · '); this.status.title = batch.payload.sources.map(s => `${s.venue}: ${s.message}`).join('\n'); this.primitive.update(); });
            } else
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

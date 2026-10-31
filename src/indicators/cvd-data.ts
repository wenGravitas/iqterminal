import { duration, instrumentOf, type Candle, type Series } from '../feed/protocol';
import { cvdAnchorAt, cvdDefaultColor, cvdSettings, type CvdEvent, type CvdRequest, type CvdSettings } from '../feed/cvd';
import type { FeedClient } from '../feed/client';
import { numericOutputContextId, numericOutputId, numericOutputSchemaId } from '../scripts/composition';
import type { ChartNumericOutputRegistry, ChartNumericOutput } from '../scripts/output-registry';
import { CvdPlotModel, cvdLowerBound, cvdNumericPlotKey } from '../chart/cvd-model';
import { effectiveCurrency } from '../currency-display';

/** Owns CVD requests and candle-aligned numeric outputs independently of the optional chart view. */
export class CvdDataController {
  readonly model = new CvdPlotModel();
  private settings: CvdSettings;
  private series: Series;
  private hostCandles: readonly Candle[] = [];
  private hostTimes: number[] = [];
  private hostKey = '';
  private contextId = '';
  private contextRevision = 0;
  private desiredKey = '';
  private requestKey = '';
  private release?: () => void;
  private listeners = new Set<(event: CvdEvent) => void>();
  private dataDemand = false;
  private hostVisible = true;
  private generation = 0;
  private publishedIds = new Set<string>();
  private dataRevision = 0;
  private outputPublications = 0;
  private subscriptionStarts = 0;
  private subscriptionStops = 0;
  private dead = false;
  private readonly visibilityListener = () => this.syncSubscription();

  constructor(private readonly chartId: string, private readonly instanceId: string, private readonly feed: FeedClient,
    private readonly registry: ChartNumericOutputRegistry, settings: unknown, series: Series, private readonly now = Date.now) {
    this.settings = cvdSettings(settings);
    this.series = series;
    this.contextId = numericOutputContextId(series);
    document.addEventListener('visibilitychange', this.visibilityListener);
    this.configure(settings, series);
    this.publishOutputs(true);
  }

  configure(value: unknown, series: Series) {
    if (this.dead) return;
    const previousSettings = this.settings, previousSeries = this.series;
    const nextSettings = cvdSettings(value), nextContext = numericOutputContextId(series);
    const settingsChanged = JSON.stringify(previousSettings) !== JSON.stringify(nextSettings);
    const selectionChanged = JSON.stringify(previousSeries) !== JSON.stringify(series);
    if (!settingsChanged && !selectionChanged) return;
    const intervalChanged = previousSeries.interval !== series.interval;
    const contextChanged = this.contextId !== nextContext;
    const requestChanged = requestKey(previousSettings) !== requestKey(nextSettings);
    const groupsChanged = JSON.stringify(previousSettings.groups) !== JSON.stringify(nextSettings.groups);
    const groupMembershipChanged = groupMembershipSignature(previousSettings.groups) !== groupMembershipSignature(nextSettings.groups);
    this.settings = nextSettings;
    this.series = series;
    this.contextId = nextContext;
    if (intervalChanged || contextChanged || groupMembershipChanged) this.contextRevision++;
    if (requestChanged) this.contextRevision++;
    const canRetainSourceHistory = contextChanged && !requestChanged
      && instrumentOf(previousSeries).base === 'BTC' && instrumentOf(series).base === 'BTC';
    if (requestChanged || contextChanged && !canRetainSourceHistory) this.model.clear();
    this.model.derive(this.settings, this.settings.units);
    if(requestChanged||contextChanged||intervalChanged||groupsChanged)this.publishOutputs(true);
    this.syncSubscription();
  }

  setHostCandles(candles: readonly Candle[]) {
    if (this.dead) return;
    const last = candles.at(-1), first = candles[0];
    const key = `${candles.length}:${first?.t ?? ''}:${last?.t ?? ''}:${last?.closed ?? ''}:${this.contextId}:${this.series.interval}`;
    // The panel mutates its candle array for forming-bar patches. CVD only
    // consumes candle opens and close state, so ordinary OHLCV revisions do
    // not need another bounded history projection.
    if (candles === this.hostCandles && key === this.hostKey) return;
    const previousLength = this.hostCandles.length;
    const previousCandles = this.hostCandles.slice(-5_000);
    const nextCandles = candles.slice(-5_000);
    const timesChanged = nextCandles.length !== this.hostTimes.length
      || nextCandles.some((candle, index) => candle.t !== this.hostTimes[index]);
    const closedChanged = previousCandles.length !== nextCandles.length
      || nextCandles.some((candle, index) => previousCandles[index]?.t === candle.t
        && previousCandles[index]?.closed !== candle.closed);
    if (key === this.hostKey && !timesChanged && !closedChanged) {
      // Snapshots can replace the array without changing its timeline.
      this.hostCandles = candles;
      return;
    }
    this.hostCandles = candles;
    this.hostTimes = nextCandles.map(candle => candle.t);
    this.hostKey = key;
    this.publishOutputs(previousLength !== candles.length || !previousLength || timesChanged || closedChanged);
  }

  setDataDemand(demanded: boolean) {
    if (this.dead || this.dataDemand === demanded) return;
    this.dataDemand = demanded;
    this.syncSubscription();
  }

  setHostVisible(visible: boolean) {
    if (this.dead || this.hostVisible === visible) return;
    this.hostVisible = visible;
    this.syncSubscription();
  }

  subscribe(listener: (event: CvdEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Read-only settings snapshot for shared pane chrome; data ownership stays in this controller. */
  settingsSnapshot() { return { ...this.settings, sources: [...this.settings.sources], groups: this.settings.groups.map(group => ({ ...group, markets: [...group.markets] })), hidden: [...this.settings.hidden], colors: { ...this.settings.colors } }; }

  /** Current candle/execution projection for the shared Order Flow legend and crosshair. */
  readoutAt(time: number) {
    const unit = effectiveCurrency(this.settings.units), period = cvdAnchorAt(time - 1, this.settings);
    this.model.derive(this.settings, unit);
    return [...this.model.lines.values()].map(line => {
      const point = this.model.value(line.id, time);
      return { id: line.id, name: line.name, value: point?.period === period ? point.value : null,
        partial: point?.period === period ? point.partial : false, hidden: this.settings.hidden.includes(line.id),
        filtered: line.filtered, unit: unit.toUpperCase(), color: this.settings.colors[line.id] ?? (line.id === 'total' ? '' : cvdDefaultColor(line.id)) };
    });
  }

  coverageSummary() {
    if (!this.settings.sources.length) return 'Choose at least one exchange.';
    if (this.settings.mode === 'aggregations' && !this.settings.groups.length) return 'Choose an exchange group in Sources.';
    const sources = this.settings.sources.map(source => this.model.sources.get(source));
    if (sources.every(source => !source?.points.at(-1)?.available)) {
      return sources.some(source => source?.status === 'unavailable') ? 'Data unavailable.' : 'Waiting for data…';
    }
    if (sources.some(source => source?.status === 'stale')) return 'Some exchange data is delayed.';
    if (sources.some(source => source?.status === 'unavailable' || !source) || sources.some(source => source?.points.at(-1)?.partial)) return 'Some data is missing.';
    return '';
  }

  demandDiagnostics() {
    return { demanded: this.dataDemand, hostVisible: this.hostVisible, subscribed: Boolean(this.release), requestKey: this.requestKey,
      sourceCount: this.model.sources.size, outputCount: this.publishedIds.size, contextRevision: this.contextRevision,
      dataRevision:this.dataRevision,outputPublications:this.outputPublications,subscriptionStarts:this.subscriptionStarts,subscriptionStops:this.subscriptionStops,
      outputRevisions:Object.fromEntries([...this.publishedIds].map(id=>[id,this.registry.get(id)?.revision??0])) };
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    document.removeEventListener('visibilitychange', this.visibilityListener);
    this.release?.(); this.release = undefined; this.listeners.clear();
    this.registry.releaseOwner(this.instanceId, 'Multi-Venue CVD was removed.');
    this.model.clear();
  }

  private syncSubscription() {
    const supported = instrumentOf(this.series).base === 'BTC';
    const key = this.dataDemand && this.hostVisible && !document.hidden && supported && this.settings.sources.length
      ? requestKey(this.settings) : '';
    if (key === this.requestKey) return;
    if(this.release)this.subscriptionStops++;
    this.release?.(); this.release = undefined;
    this.requestKey = key; const generation = ++this.generation;
    this.model.clear();
    if (!key) {
      this.registry.markUnavailable(this.instanceId, 'CVD data demand is paused.');
      return;
    }
    const request: CvdRequest = { sources: [...this.settings.sources], anchor: this.settings.anchor,
      origin: this.settings.origin, custom: this.settings.custom };
    this.subscriptionStarts++;
    this.release = this.feed.subscribeCvd(`cvd:${this.chartId}:${this.instanceId}`, request, event => {
      if (this.dead || generation !== this.generation || this.requestKey !== key) return;
      this.receive(event);
    });
  }

  private receive(event: CvdEvent) {
    let full = false, changedFrom = Infinity, changed = false;
    for (const series of event.series) {
      const previous = this.model.sources.get(series.source);
      const stateChanged=!previous||previous.status!==series.status||!sameCvdCoverage(previous.coverage,series.coverage)
        ||previous.removeBefore!==series.removeBefore;
      const pointsChanged=!previous||changedCvdPoints(previous.points,series.points,series.snapshot);
      if(!stateChanged&&!pointsChanged){
        // Keep source diagnostics current without making an as-of-only or
        // repeated failure poll redraw/project the chart.
        if(previous)this.model.sources.set(series.source,{...previous,snapshot:series.snapshot,removeBefore:series.removeBefore,
          coverage:series.coverage,status:series.status,message:series.message,asOf:series.asOf});
        continue;
      }
      changed=true;
      if(stateChanged||series.snapshot)full=true;
      if(pointsChanged&&!series.snapshot)changedFrom=Math.min(changedFrom,changedCvdPointStart(previous?.points??[],series.points));
      this.model.update(series);
    }
    if(!changed)return;
    this.dataRevision++;
    this.model.derive(this.settings, this.settings.units);
    this.publishOutputs(full || changedFrom === Infinity, changedFrom);
    for (const listener of [...this.listeners]) listener(event);
  }

  private publishOutputs(full: boolean, changedFrom = Infinity) {
    if (this.dead) return;
    const projections = this.model.projectNumericOutputs(this.settings, this.hostCandles, duration[this.series.interval], this.now());
    const outputs: ChartNumericOutput[] = projections.map(projection => {
      const outputId = numericOutputId(this.instanceId, projection.plotKey), previous = this.registry.get(outputId);
      const changedIndex = full || !previous || previous.values.length !== projection.values.length ? 0 : this.hostChangeIndex(changedFrom);
      let changedTo = projection.values.length;
      if (previous && changedIndex < projection.values.length && changedIndex > 0) {
        // Corrections return the cumulative suffix. An anchor change is published as a full range above.
        changedTo = projection.values.length;
      }
      return {
        kind: 'indicator-output', version: 1, instanceId: this.instanceId, outputId, plotKey: projection.plotKey,
        schemaId: numericOutputSchemaId(projection.plotKey, projection.unit), domain: 'chart-candles-v1',
        contextId: this.contextId, unit: projection.unit, title: projection.title,
        revision: (previous?.revision ?? 0) + 1, contextRevision: this.contextRevision, available: projection.available,
        times: this.hostTimes, values: projection.values, quantity: 'cumulative', marketScope: this.contextId,
        sourceScope: projection.sourceScope, timestampConvention: 'candle-open', quality: projection.quality,
        resets: projection.resets, changedRange: { from: changedIndex, to: changedTo },
      };
    });
    const nextIds = new Set(outputs.map(output => output.outputId));
    for (const outputId of this.publishedIds) if (!nextIds.has(outputId)) this.registry.releaseOutput(this.instanceId, outputId, 'CVD source or aggregation was removed.');
    const changedOutputs=outputs.filter(output=>!samePublishedOutput(this.registry.get(output.outputId),output));
    try { if(changedOutputs.length){this.registry.publishMany(changedOutputs);this.outputPublications++;} this.publishedIds = nextIds; }
    catch (error) {
      this.registry.markUnavailable(this.instanceId, `CVD output publication failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private hostChangeIndex(time: number) {
    if (!Number.isFinite(time) || !this.hostTimes.length) return 0;
    const at = lowerBound(this.hostTimes, time);
    return Math.max(0, Math.min(this.hostTimes.length, at - 1));
  }

}

function requestKey(settings: CvdSettings) { return JSON.stringify([settings.sources, settings.anchor, settings.origin, settings.custom]); }
function groupMembershipSignature(groups: CvdSettings['groups']) {
  const entries = groups.map(group => [group.id, [...group.markets].sort()] as const);
  return JSON.stringify(entries.sort((left, right) => left[0].localeCompare(right[0])));
}
function outputKeys(settings: CvdSettings) {
  const entities=['total',...settings.sources,...settings.groups.map(group=>`group:${group.id}`)];
  return ['BTC','USDT'].flatMap(unit=>entities.map(id=>cvdNumericPlotKey(id,unit as 'BTC'|'USDT')));
}
function lowerBound(values:readonly number[],value:number){let low=0,high=values.length;while(low<high){const mid=(low+high)>>>1;if(values[mid]!<value)low=mid+1;else high=mid;}return low;}
type CvdPoint=CvdEvent['series'][number]['points'][number];
type CvdSeries=CvdEvent['series'][number];
function sameCvdPoint(a:CvdPoint|undefined,b:CvdPoint){
  return !!a&&a.time===b.time&&a.period===b.period&&a.base===b.base&&a.quote===b.quote
    &&a.observed===b.observed&&a.available===b.available&&a.partial===b.partial&&a.reset===b.reset;
}
function changedCvdPointStart(previous:readonly CvdPoint[],next:readonly CvdPoint[]){
  let first=Infinity;
  for(const point of next){const index=cvdLowerBound(previous,point.time,row=>row.time);if(!sameCvdPoint(previous[index],point))first=Math.min(first,point.time);}
  return first;
}
function sameCvdCoverage(a:CvdSeries['coverage'],b:CvdSeries['coverage']){
  return a.from===b.from&&a.to===b.to&&JSON.stringify(a.gaps)===JSON.stringify(b.gaps);
}
function changedCvdPoints(previous:readonly CvdPoint[],next:readonly CvdPoint[],snapshot:boolean){
  if(snapshot){
    if(previous.length!==next.length)return true;
    return next.some((point,index)=>!sameCvdPoint(previous[index],point));
  }
  if(next.some(point=>{const index=cvdLowerBound(previous,point.time,row=>row.time);return !sameCvdPoint(previous[index],point);}))return true;
  return false;
}
function samePublishedOutput(previous:ChartNumericOutput|undefined,next:ChartNumericOutput){
  if(!previous||previous.title!==next.title||previous.contextId!==next.contextId||previous.contextRevision!==next.contextRevision
    ||previous.unit!==next.unit||previous.available!==next.available||previous.quantity!==next.quantity||previous.marketScope!==next.marketScope
    ||previous.sourceScope!==next.sourceScope||previous.timestampConvention!==next.timestampConvention||previous.quality!==next.quality
    ||JSON.stringify(previous.resets)!==JSON.stringify(next.resets)||previous.times.length!==next.times.length||previous.values.length!==next.values.length)return false;
  for(let index=0;index<next.times.length;index++)if(previous.times[index]!==next.times[index]||previous.values[index]!==next.values[index])return false;
  return true;
}

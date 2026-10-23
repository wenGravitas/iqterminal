import { RemoteEffortService } from '../effort-result/remote';
/// <reference lib="webworker" />
import { LevelWatchTransport } from './level-watch';
import type { WatchCommand } from '../level-watch/types';
import { parseLive } from './adapters';
import { MarketService } from './service';
import { StagingHeatmapService } from './staging-heatmap';
import { StagingDepthMatrixService } from './staging-depth-matrix';
import { DepthMatrixFixtureService } from './depth-matrix-fixtures';
import { depthMatrixSourceLabel } from './depth-matrix';
import { BinanceHeatmapService } from './heatmap-service';
import { BinanceDepthService } from './depth-service';
import { DirectOrderWallsService } from './direct-order-walls';
import { StagingOrderWallsService } from './staging-order-walls';
import { StagingNetPositioningService } from './staging-net-positioning';
import { TickerService } from './ticker-service';
import { BinanceFootprintService } from './footprint-service';
import { TpoService } from './tpo-service';
import { StagingFeedService, stagingMarket } from './staging-service';
import { heatmapKey } from './heatmap-model';
import { fixtureBars } from './fixtures';
import { duration, marketOf, type Command, type Event, type Series } from './protocol';
import { MINUTE_MS, type TpoMinute } from '../indicators/tpo-engine';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let fixture=false;
let alignFixtureToNow=false;
const fixtureOptions = () => ({
  history: async (series: Series) => {
    const bars = fixtureBars(series);
    if (!alignFixtureToNow || !bars.length) return bars;
    const step = duration[series.interval];
    const end = Math.floor(Date.now() / step) * step;
    const shift = end - bars.at(-1)!.t;
    return bars.map(bar => ({ ...bar, t: bar.t + shift }));
  },
  socket: () => ({ readyState: 0, close() {}, send() {} } as unknown as WebSocket),
  now: Date.now,
  random: () => .5,
});
const stagingMode = import.meta.env.VITE_DATA_MODE === 'staging';
const emitDirect = (e: Event) => scope.postMessage(stagingMode && e.type === 'status' ? { ...e, status: { ...e.status, message: `Direct venue · ${e.status.message}` } } : e);
let tpoService: TpoService;
const marketEvent = (event: Event) => {
  emitDirect(event);
  if (event.type === 'snapshot' || event.type === 'patch') tpoService?.marketEvent(event);
};
let service=new MarketService(marketEvent);
const createTpoService = (fixtureMinutes?: Map<string, TpoMinute[]>) => new TpoService({
  emit: event => scope.postMessage(event),
  marketCommand: command => service.command(command),
  ...(fixtureMinutes ? { transport: { now: Date.now, page: async (series: Series, from: number, to: number) => {
    const key = `${series.venue}:${marketOf(series)}`;
    let bars = fixtureMinutes.get(key);
    if (!bars) {
      const source = { ...series, interval: '1m' as const };
      const raw = fixtureBars(source);
      const shift = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - raw.at(-1)!.t;
      bars = raw.map(candle => ({ time: candle.t + shift, open: candle.o, high: candle.h, low: candle.l, close: candle.c, revision: candle.revision, closed: candle.closed }));
      fixtureMinutes.set(key, bars);
    }
    return bars.filter(bar => bar.time >= from && bar.time < to);
  } } } : {}),
});
tpoService = createTpoService();
const depth=new BinanceDepthService((e:Event)=>scope.postMessage(e));
const heatmap=new BinanceHeatmapService(depth, e=>scope.postMessage(e));
const footprint=new BinanceFootprintService((e:Event)=>scope.postMessage(e), undefined, {}, import.meta.env.DEV || import.meta.env.VITE_DIAGNOSTICS==='1');
const spotFootprint=new BinanceFootprintService((e:Event)=>scope.postMessage(e), undefined, {}, import.meta.env.DEV || import.meta.env.VITE_DIAGNOSTICS==='1', 'spot');
const efforts = new RemoteEffortService(e=>scope.postMessage(e),stagingMode);
const tickers = new TickerService({perpetual:footprint,spot:spotFootprint}, e => scope.postMessage(e));
const staging = stagingMode ? new StagingFeedService(e => scope.postMessage(e)) : undefined;
const stagingHeatmap = stagingMode ? new StagingHeatmapService(e=>scope.postMessage(e)) : undefined;
const directOrderWalls = new DirectOrderWallsService(depth, emitDirect);
const stagingOrderWalls = stagingHeatmap ? new StagingOrderWallsService(stagingHeatmap, e=>scope.postMessage(e)) : undefined;
const stagingDepthMatrix = stagingHeatmap ? new StagingDepthMatrixService(stagingHeatmap, e=>scope.postMessage(e)) : undefined;
const depthMatrixFixtures = new DepthMatrixFixtureService(e=>scope.postMessage(e));
const stagingNetPositioning = new StagingNetPositioningService(e => scope.postMessage(e), stagingMode);
const stagingClients = new Set<string>();
const watchTransport=new LevelWatchTransport(message=>scope.postMessage(message),()=>stagingMode&&!fixture);
let burst:ReturnType<typeof setInterval>|undefined;let revision=1;let received=0;
scope.onmessage=(event:MessageEvent<Command>)=>{
  if((import.meta.env.DEV||import.meta.env.VITE_DIAGNOSTICS==='1')&&(event.data as unknown as {type:string}).type==='initFixture'){
    fixture=true;
    stagingNetPositioning.setEnabled(false);
    directOrderWalls.setFixture(true);
    alignFixtureToNow=Boolean((event.data as unknown as {alignToNow?:boolean}).alignToNow);
    tpoService.dispose();
    service.dispose();
    service=new MarketService(marketEvent,fixtureOptions());
    tpoService=createTpoService(new Map());
    return;
  }
  if(event.data.type.startsWith('watch-')){watchTransport.command(event.data as unknown as WatchCommand);return;}
  const c=event.data;
  if(c.type==='effort-claim'){void efforts.claim(c.id,c.key,c.eventId,c.state);return;}
  if(c.type==='effort-alerted'){efforts.alerted(c.key,c.eventId,c.state,c.at);return;}
  if(c.type==='effort-export'){efforts.export(c.id,c.key);return;}
  if(c.type==='effort-subscribe'){efforts.subscribe(c.id,c.series,c.settings,fixture);return;}
  if(c.type==='effort-unsubscribe'){efforts.unsubscribe(c.id);return;}
  if(c.type==='tpo-subscribe'){tpoService.subscribe(c.id,c.series,c.settings);return;}
  if(c.type==='tpo-settings'){tpoService.updateSettings(c.id,c.settings);return;}
  if(c.type==='tpo-unsubscribe'){tpoService.unsubscribe(c.id);return;}
  if(c.type==='tpo-retry'){tpoService.retry(c.id);return;}
  if(c.type==='net-positioning-subscribe'){stagingNetPositioning.subscribe(c.id,c.request);return;}
  if(c.type==='net-positioning-unsubscribe'){stagingNetPositioning.unsubscribe(c.id);return;}
  if(c.type.startsWith('depth-matrix-')){
    if(fixture){depthMatrixFixtures.command(c as Extract<Command,{type:'depth-matrix-subscribe'|'depth-matrix-settings'|'depth-matrix-viewport'|'depth-matrix-unsubscribe'|'depth-matrix-retry'}>);return;}
    if(stagingDepthMatrix){stagingDepthMatrix.command(c as Extract<Command,{type:'depth-matrix-subscribe'|'depth-matrix-settings'|'depth-matrix-viewport'|'depth-matrix-unsubscribe'|'depth-matrix-retry'}>);return;}
    if(c.type==='depth-matrix-subscribe'||c.type==='depth-matrix-settings')scope.postMessage({type:'depth-matrix-batch',ids:[c.id],settings:c.settings,
      columns:c.settings.sources.map(source=>({source,label:depthMatrixSourceLabel(source),
        state:'unavailable',message:fixture?'Depth Matrix does not generate fixture order books.':'Depth Matrix requires the synchronized staging collectors.',rows:[],bestBid:null,bestAsk:null,mid:null,quantityUnit:'BTC',notionalUnit:'USDT',lastAt:0,ageMs:null,cursor:0,epoch:null})),emittedAt:Date.now()});
    return;
  }
  if(c.type==='order-wall-subscribe'||c.type==='order-wall-unsubscribe'||c.type==='order-wall-settings'||c.type==='order-wall-viewport'){
    if(stagingOrderWalls&&!fixture)stagingOrderWalls.command(c);
    else directOrderWalls.command(c);
    return;
  }
  if (staging && !fixture) {
    // 30m/1d native candles are explicitly direct venue sources: the private backend contract supports the original five intervals.
    if ((c.type === 'subscribe' || c.type === 'footprint-subscribe') && stagingMarket(c.series) && !(c.type === 'subscribe' && (c.series.interval === '30m' || c.series.interval === '1d'))) { stagingClients.add(c.id); staging.command(c); return; }
    if ((c.type === 'unsubscribe' || c.type === 'footprint-unsubscribe' || c.type === 'retry') && stagingClients.has(c.id)) {
      staging.command(c); if (c.type !== 'retry') stagingClients.delete(c.id); return;
    }
    if (c.type === 'footprint-viewport' || c.type === 'footprint-ack' || c.type === 'footprint-retry') { staging.command(c); return; }
    if(c.type.startsWith('heatmap-')){stagingHeatmap?.command(c);return;}
    if(c.type==='online'||c.type==='depth-retry')stagingHeatmap?.command(c);
    if(c.type==='online')stagingDepthMatrix?.setOnline(c.online);
    if(c.type==='depth-retry')stagingDepthMatrix?.retry();
    if (c.type === 'online') staging.command(c);
  }
  if(c.type==='ticker-subscribe'){tickers.subscribe(c.id,c.config,c.configRevision);return;}
  if(c.type==='ticker-update'){tickers.update(c.id,c.config,c.configRevision);return;}
  if(c.type==='ticker-unsubscribe'){tickers.unsubscribe(c.id);return;}
  if(c.type==='ticker-ack'){tickers.ack(c.id,c.generation,c.batchId);return;}
  if(c.type==='fixture'&&fixture){clearInterval(burst);if(c.rate>0)burst=setInterval(()=>{
    const entries=[...service.entries.values()];if(!entries.length)return;
    const lasts=entries.map(e=>e.data.snapshot().at(-1));
    for(let i=0;i<c.rate/20;i++){const index=(received++)%entries.length,e=entries[index],last=lasts[index];if(last){const next={...last,c:last.o+Math.sin(revision*.02)*30,h:last.o+50,l:last.o-50,v:revision,revision:revision++,closed:false};const raw=e.series.venue==='binance'?{e:'kline',E:next.revision,k:{s:'BTCUSDT',i:e.series.interval,t:next.t,o:next.o,h:next.h,l:next.l,c:next.c,v:next.v,x:false}}:{channel:'candle',data:{s:'BTC',i:e.series.interval,t:next.t,T:Date.now()+60000,o:next.o,h:next.h,l:next.l,c:next.c,v:next.v,n:next.revision}};service.ingest(e,parseLive(JSON.parse(JSON.stringify(raw)),e.series));}}
  },50);return;}
  if(c.type==='heatmap-subscribe'){
    if(c.market==='spot'){
      scope.postMessage({type:'heatmap-batch',key:heatmapKey(c.resolution),ids:[c.id],generation:0,batchId:0,snapshot:true,buckets:[],status:{state:'failed',message:'Binance Spot heatmap requires the staged depth service; USD-M depth is never used as a fallback.',tickSize:null,collectionStart:null,retentionStart:null,capacityLimited:false}});
      return;
    }
    heatmap.subscribe(c.id,c.resolution);return;
  }
  if(c.type==='heatmap-unsubscribe'){heatmap.unsubscribe(c.id);return;}
  if(c.type==='heatmap-ack'){heatmap.ack(c.key,c.generation,c.batchId);return;}
  if(c.type==='depth-subscribe'){depth.subscribe(c.id,c.bandPercent);return;}
  if(c.type==='depth-unsubscribe'){depth.unsubscribe(c.id);return;}
  if(c.type==='depth-retry'){depth.retry();heatmap.retry();return;}
  if(c.type==='footprint-subscribe'){(marketOf(c.series)==='spot'?spotFootprint:footprint).command(c);return;}
  if(c.type==='footprint-unsubscribe'){footprint.command(c);spotFootprint.command(c);return;}
  if(c.type==='footprint-retry'){footprint.command(c);spotFootprint.command(c);return;}
  if(c.type==='footprint-ack'){footprint.command(c);spotFootprint.command(c);return;}
  if(c.type==='online'){depth.setOnline(c.online);footprint.setOnline(c.online);spotFootprint.setOnline(c.online);}
  if(c.type==='diagnostics'){scope.postMessage({type:'diagnostics',data:{...service.diagnostics(),tpo:tpoService.diagnostics(),staging:staging?.diagnostics(),depth:depth.diagnostics(),heatmap:stagingMode&&!fixture?stagingHeatmap?.diagnostics():heatmap.diagnostics(),orderWalls:stagingMode&&!fixture?stagingOrderWalls?.diagnostics():directOrderWalls.diagnostics(),depthMatrix:fixture?depthMatrixFixtures.diagnostics():stagingDepthMatrix?.diagnostics(),netPositioning:stagingNetPositioning.diagnostics(),footprint:footprint.diagnostics(),spotFootprint:spotFootprint.diagnostics(),tickers:tickers.diagnostics(),effortResult:efforts.diagnostics(),fixture,networkSockets:fixture?0:service.diagnostics().sockets,syntheticMessages:received}});return;}
  service.command(c);
};

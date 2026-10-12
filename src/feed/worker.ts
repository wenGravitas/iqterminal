/// <reference lib="webworker" />
import { parseLive } from './adapters';
import { MarketService } from './service';
import { StagingHeatmapService } from './staging-heatmap';
import { BinanceHeatmapService } from './heatmap-service';
import { BinanceDepthService } from './depth-service';
import { TickerService } from './ticker-service';
import { BinanceFootprintService } from './footprint-service';
import { StagingFeedService, stagingMarket } from './staging-service';
import { fixtureBars } from './fixtures';
import { duration, type Command, type Event, type Series } from './protocol';
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
let service=new MarketService(emitDirect);
const depth=new BinanceDepthService((e:Event)=>scope.postMessage(e));
const heatmap=new BinanceHeatmapService(depth, e=>scope.postMessage(e));
const footprint=new BinanceFootprintService((e:Event)=>scope.postMessage(e), undefined, {}, import.meta.env.DEV || import.meta.env.VITE_DIAGNOSTICS==='1');
const tickers = new TickerService(footprint, e => scope.postMessage(e));
const staging = stagingMode ? new StagingFeedService(e => scope.postMessage(e)) : undefined;
const stagingHeatmap = stagingMode ? new StagingHeatmapService(e=>scope.postMessage(e)) : undefined;
const stagingClients = new Set<string>();
let burst:ReturnType<typeof setInterval>|undefined;let revision=1;let received=0;
scope.onmessage=(event:MessageEvent<Command>)=>{
  if((import.meta.env.DEV||import.meta.env.VITE_DIAGNOSTICS==='1')&&(event.data as unknown as {type:string}).type==='initFixture'){
    fixture=true;
    alignFixtureToNow=Boolean((event.data as unknown as {alignToNow?:boolean}).alignToNow);
    service.dispose();
    service=new MarketService(e=>scope.postMessage(e),fixtureOptions());
    return;
  }
  const c=event.data;
  if (staging && !fixture) {
    if ((c.type === 'subscribe' || c.type === 'footprint-subscribe') && stagingMarket(c.series)) { stagingClients.add(c.id); staging.command(c); return; }
    if ((c.type === 'unsubscribe' || c.type === 'footprint-unsubscribe' || c.type === 'retry') && stagingClients.has(c.id)) {
      staging.command(c); if (c.type !== 'retry') stagingClients.delete(c.id); return;
    }
    if (c.type === 'footprint-ack' || c.type === 'footprint-retry') { staging.command(c); return; }
    if(c.type.startsWith('heatmap-')){stagingHeatmap?.command(c);return;}
    if(c.type==='online'||c.type==='depth-retry')stagingHeatmap?.command(c);
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
  if(c.type==='heatmap-subscribe'){heatmap.subscribe(c.id,c.resolution);return;}
  if(c.type==='heatmap-unsubscribe'){heatmap.unsubscribe(c.id);return;}
  if(c.type==='heatmap-ack'){heatmap.ack(c.key,c.generation,c.batchId);return;}
  if(c.type==='depth-subscribe'){depth.subscribe(c.id,c.bandPercent);return;}
  if(c.type==='depth-unsubscribe'){depth.unsubscribe(c.id);return;}
  if(c.type==='depth-retry'){depth.retry();heatmap.retry();return;}
  if(c.type==='footprint-subscribe'||c.type==='footprint-unsubscribe'||c.type==='footprint-retry'||c.type==='footprint-ack'){footprint.command(c);return;}
  if(c.type==='online'){depth.setOnline(c.online);footprint.setOnline(c.online);}
  if(c.type==='diagnostics'){scope.postMessage({type:'diagnostics',data:{...service.diagnostics(),staging:staging?.diagnostics(),depth:depth.diagnostics(),heatmap:stagingMode&&!fixture?stagingHeatmap?.diagnostics():heatmap.diagnostics(),footprint:footprint.diagnostics(),tickers:tickers.diagnostics(),fixture,networkSockets:fixture?0:service.diagnostics().sockets,syntheticMessages:received}});return;}
  service.command(c);
};

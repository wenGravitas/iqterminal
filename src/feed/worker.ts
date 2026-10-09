/// <reference lib="webworker" />
import { parseLive } from './adapters';
import { MarketService } from './service';
import { fixtureBars } from './fixtures';
import { type Command, type Event } from './protocol';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let fixture=false;
let service=new MarketService((e:Event)=>scope.postMessage(e),fixture?{history:async s=>fixtureBars(s),socket:()=>({readyState:0,close(){},send(){}} as unknown as WebSocket),now:Date.now,random:()=>.5}:undefined);
let burst:ReturnType<typeof setInterval>|undefined;let revision=1;let received=0;
scope.onmessage=(event:MessageEvent<Command>)=>{
  if((import.meta.env.DEV||import.meta.env.VITE_DIAGNOSTICS==='1')&&(event.data as unknown as {type:string}).type==='initFixture'){fixture=true;service.dispose();service=new MarketService(e=>scope.postMessage(e),{history:async s=>fixtureBars(s),socket:()=>({readyState:0,close(){},send(){}} as unknown as WebSocket),now:Date.now,random:()=>.5});return;}
  const c=event.data;
  if(c.type==='fixture'&&fixture){clearInterval(burst);if(c.rate>0)burst=setInterval(()=>{
    const entries=[...service.entries.values()];if(!entries.length)return;
    const lasts=entries.map(e=>e.data.snapshot().at(-1));
    for(let i=0;i<c.rate/20;i++){const index=(received++)%entries.length,e=entries[index],last=lasts[index];if(last){const next={...last,c:last.o+Math.sin(revision*.02)*30,h:last.o+50,l:last.o-50,v:revision,revision:revision++,closed:false};const raw=e.series.venue==='binance'?{e:'kline',E:next.revision,k:{s:'BTCUSDT',i:e.series.interval,t:next.t,o:next.o,h:next.h,l:next.l,c:next.c,v:next.v,x:false}}:{channel:'candle',data:{s:'BTC',i:e.series.interval,t:next.t,T:Date.now()+60000,o:next.o,h:next.h,l:next.l,c:next.c,v:next.v,n:next.revision}};service.ingest(e,parseLive(JSON.parse(JSON.stringify(raw)),e.series));}}
  },50);return;}
  if(c.type==='diagnostics'){scope.postMessage({type:'diagnostics',data:{...service.diagnostics(),fixture,networkSockets:fixture?0:service.diagnostics().sockets,syntheticMessages:received}});return;}
  service.command(c);
};

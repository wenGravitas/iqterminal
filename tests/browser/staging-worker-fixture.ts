import type {BrowserContext} from '@playwright/test';
export async function installHealthyStagingWorker(context:BrowserContext,emitCandles=true){
 // The feed owns WebSockets inside a dedicated worker. Install this explicit
 // deterministic transport in the worker bundle, so the unrelated native feed
 // stays healthy even when no staging tunnel exists. Page socket routes do not
 // establish that precondition for the worker.
 await context.route('**/assets/worker-*.js',async route=>{
  const response=await route.fetch();const script=await response.text();
  if(!script.includes('Invalid durable execution batch'))return route.fulfill({response});
  const transport=`globalThis.__stagingNativeFixture={emitCandles:${emitCandles},sockets:[]};globalThis.WebSocket=class {
   static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
   readyState=0;timer;onopen;onmessage;onclose;onerror;
   constructor(){globalThis.__stagingNativeFixture.sockets.push(this);setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.({});},0);}
   send(wire){const command=JSON.parse(wire);this.command=command;const steps={'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};const health=()=>{if(command.interval&&globalThis.__stagingNativeFixture.emitCandles){const step=steps[command.interval];this.onmessage?.({data:JSON.stringify({type:'native-candle',source:'binance-native-kline',interval:command.interval,candle:{t:Math.floor(Date.now()/step)*step,o:80000,h:80025,l:79975,c:80010,v:8,revision:Date.now(),closed:false}})});}this.onmessage?.({data:JSON.stringify({type:'health',collector:{state:'live',lastUpdate:Date.now()},watermark:{id:1}})});};health();clearInterval(this.timer);this.timer=setInterval(health,500);}
   close(){clearInterval(this.timer);this.readyState=3;this.onclose?.({});}
  };`;
  await route.fulfill({response,body:transport+'\n'+script});
 });
}

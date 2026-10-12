import type { Page } from '@playwright/test';
/** Explicit fixture transport only; uses the real normalization/shared worker services. */
export async function installTradeFixture(page: Page) {
  await page.goto('/?fixture=1&fixtureTime=now');await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((p:any)=>p.bars===5000));
  const worker=page.workers()[0]!;
  await worker.evaluate(()=>{
    const nativeFetch=self.fetch.bind(self),NativeSocket=self.WebSocket;
    const probe:any=(self as any).__tradeFixture={sockets:0,active:0,seq:1,socket:null as any};
    self.fetch=async(input:any,options:any)=>String(input).includes('/exchangeInfo')?new Response(JSON.stringify({symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL',baseAsset:'BTC',quoteAsset:'USDT',marginAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.10'}]}]})):nativeFetch(input,options);
    class Socket {readyState=0;onopen:Function|null=null;onmessage:Function|null=null;onclose:Function|null=null;onerror:Function|null=null;constructor(){probe.sockets++;probe.active++;probe.socket=this;setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.();},10);}close(){if(this.readyState===3)return;this.readyState=3;probe.active--;this.onclose?.();}send(){} }
    self.WebSocket=new Proxy(NativeSocket,{construct(target,args){return String(args[0]).includes('@aggTrade')?new Socket():Reflect.construct(target,args);}}) as any;
    probe.emit=(quantity=10,side='buy',id?:number,age=0)=>{const a=id??probe.seq++,T=Date.now()-age;probe.socket.onmessage?.({data:JSON.stringify({e:'aggTrade',s:'BTCUSDT',a,f:a*2,l:a*2+1,T,E:Math.max(T,Date.now()),p:'100000',q:String(quantity),m:side==='sell',st:1})});};
  });return worker;
}

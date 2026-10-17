import type { Page } from '@playwright/test';
/** Explicit fixture transport only; uses the real normalization/shared worker services. */
export async function installTradeFixture(page: Page) {
  await page.goto('/?fixture=1&fixtureTime=now');await page.waitForFunction(()=>(window as any).__terminal?.stats().panels.every((p:any)=>p.bars===5000));
  const worker=page.workers()[0]!;
  await worker.evaluate(()=>{
    const nativeFetch=self.fetch.bind(self),NativeSocket=self.WebSocket;
    const probe:any=(self as any).__tradeFixture={sockets:0,active:0,seq:{spot:1,perpetual:1},socket:null as any,byMarket:{} as Record<string,any>};
    self.fetch=async(input:any,options:any)=>{
      const url=String(input);
      if(!url.includes('/exchangeInfo'))return nativeFetch(input,options);
      const spot=url.includes('/api/v3/');
      return new Response(JSON.stringify({symbols:[{symbol:'BTCUSDT',status:'TRADING',...(spot?{}:{contractType:'PERPETUAL',marginAsset:'USDT'}),baseAsset:'BTC',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:spot?'0.01':'0.10'}]}]}));
    };
    class Socket {readyState=0;onopen:Function|null=null;onmessage:Function|null=null;onclose:Function|null=null;onerror:Function|null=null;market:string;constructor(url:string){this.market=new URL(url).hostname.startsWith('fstream.')?'perpetual':'spot';probe.sockets++;probe.active++;probe.socket=this;probe.byMarket[this.market]=this;setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.();},10);}close(){if(this.readyState===3)return;this.readyState=3;probe.active--;this.onclose?.();}send(){} }
    self.WebSocket=new Proxy(NativeSocket,{construct(target,args){const url=String(args[0]);return url.includes('@aggTrade')?new Socket(url):Reflect.construct(target,args);}}) as any;
    probe.emit=(quantity=10,side='buy',id?:number,age=0,market='perpetual')=>{const socket=probe.byMarket[market];if(!socket)return;const a=id??probe.seq[market]++,T=Date.now()-age;socket.onmessage?.({data:JSON.stringify({e:'aggTrade',s:'BTCUSDT',a,f:a*2,l:a*2+1,T,E:Math.max(T,Date.now()),p:'100000',q:String(quantity),m:side==='sell',...(market==='perpetual'?{st:1}:{})})});};
  });return worker;
}

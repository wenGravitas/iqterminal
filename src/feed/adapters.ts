import { type Candle, type Series, duration, validCandle } from './protocol';
type Wire = Record<string, unknown>;
const object = (x: unknown): Wire => x && typeof x==='object' ? x as Wire : {};
export function hyperCandle(raw: unknown, s: Series, history=false, now=Date.now()): Candle | null {
  const d=object(raw);
  if(d.s!=='BTC'||d.i!==s.interval) return null;
  const c:Candle={t:Number(d.t),o:Number(d.o),h:Number(d.h),l:Number(d.l),c:Number(d.c),v:Number(d.v),revision:history?0:Number(d.n),closed:Number(d.T)<now};
  return validCandle(c)?c:null;
}
export function parseLive(raw: unknown, s: Series): Candle[] {
  const m=object(raw);
  if(s.venue==='hyperliquid') {
    if(m.channel!=='candle')return [];
    return (Array.isArray(m.data)?m.data:[m.data]).map(x=>hyperCandle(x,s)).filter((c):c is Candle=>c!==null);
  }
  const d=object(m.data ?? m),k=object(d.k);
  if(d.e!=='kline'||k.s!=='BTCUSDT'||k.i!==s.interval || (d.st!==undefined && d.st!==1))return [];
  const c:Candle={t:Number(k.t),o:Number(k.o),h:Number(k.h),l:Number(k.l),c:Number(k.c),v:Number(k.v),revision:Number(d.E),closed:k.x===true};
  return validCandle(c)?[c]:[];
}
export class HttpError extends Error { constructor(message:string,readonly hard:boolean,readonly retryAfter=0) { super(message); } }
export async function history(s:Series,signal:AbortSignal,start?:number):Promise<Candle[]> {
  const now=Date.now();
  const url=s.venue==='binance'?`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${s.interval}&limit=1000${start?`&startTime=${start}`:''}`:'https://api.hyperliquid.xyz/info';
  const response=await fetch(url,s.venue==='binance'?{signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'candleSnapshot',req:{coin:'BTC',interval:s.interval,startTime:start??now-duration[s.interval]*1000,endTime:now}}),signal});
  if(!response.ok)throw new HttpError(`History HTTP ${response.status}`,response.status>=400&&response.status<500&&![408,429].includes(response.status),Number(response.headers.get('Retry-After')??0)*1000);
  const data:unknown=await response.json();
  if(!Array.isArray(data))throw new HttpError('Invalid history response',true);
  const candles=data.map((x):Candle|null=> {
    if(s.venue==='hyperliquid')return hyperCandle(x,s,true,now);
    if(!Array.isArray(x))return null;
    const c:Candle={t:Number(x[0]),o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),v:Number(x[5]),revision:0,closed:Number(x[6])<now};
    return validCandle(c)?c:null;
  }).filter((c):c is Candle=>!!c);
  if(!candles.length)throw new HttpError('History returned no valid candles',true);
  return candles;
}
export const socketURL = (venue:Series['venue'])=>venue==='binance'?'wss://fstream.binance.com/market/stream':'wss://api.hyperliquid.xyz/ws';
export function subscription(s:Series,subscribe:boolean,id:number) {
  return s.venue==='binance'?{method:subscribe?'SUBSCRIBE':'UNSUBSCRIBE',params:[`btcusdt@kline_${s.interval}`],id:String(id)}:{method:subscribe?'subscribe':'unsubscribe',subscription:{type:'candle',coin:'BTC',interval:s.interval}};
}

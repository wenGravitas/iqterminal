import { afterEach, expect, it, vi } from 'vitest';
import { parseBybitTrades } from '../src/feed/bybit';
import { BybitExecutionService } from '../src/feed/bybit-service';
import { TickerService } from '../src/feed/ticker-service';
import { CvdService } from '../src/feed/cvd-service';
import { CvdCalculation, cvdSettings } from '../src/feed/cvd';
import { tickerConfig, classify } from '../src/ticker/model';
import { netPositioningSettings } from '../src/indicators/model';
import { executionMatchesSeries } from '../src/ticker/hover';
const now=1793094120000;
const wire=(id='a',side='Buy')=>({topic:'publicTrade.BTCUSDT',type:'snapshot',ts:now,data:[{s:'BTCUSDT',i:id,S:side,T:now,p:'80000.10',v:'0.00123'}]});
afterEach(()=>vi.useRealTimers());
it('normalizes Bybit taker side and exact BTC/notional while rejecting malformed batches atomically',()=>{
 const [trade]=parseBybitTrades(wire(),now+5);expect(trade).toMatchObject({venue:'bybit',market:'perpetual',granularity:'individual-trade',side:'buy',quantity:.00123,quoteNotionalText:'98.400123',executionId:'bybit:perpetual:BTCUSDT:trade:a'});
 expect(parseBybitTrades(wire('b','Sell'))[0].side).toBe('sell');
 expect(parseBybitTrades({...wire(),topic:'publicTrade.ETHUSDT'})).toEqual([]);
 expect(()=>parseBybitTrades({...wire(),data:[wire().data[0],{...wire().data[0],S:'Unknown'}]})).toThrow();
 expect(()=>parseBybitTrades({...wire(),data:[{...wire().data[0],v:'NaN'}]})).toThrow();
 expect(executionMatchesSeries(trade,{venue:'binance',market:'perpetual',interval:'1m'})).toBe(false);
});
class Socket {readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;send=vi.fn();close=vi.fn();}
it('shares one demand-owned socket, deduplicates, rejects conflicting IDs and closes after the final consumer',()=>{
 vi.useFakeTimers();const sockets:Socket[]=[],a:any[]=[],b:any[]=[];
 const feed=new BybitExecutionService({socket:()=>{const s=new Socket();sockets.push(s);return s as any;},now:()=>now});
 const releaseA=feed.subscribeExecutions('a',(trades,status)=>a.push({trades,status})),releaseB=feed.subscribeExecutions('b',(trades,status)=>b.push({trades,status}));
 expect(sockets).toHaveLength(1);const s=sockets[0];s.onopen();expect(s.send).toHaveBeenCalledWith(JSON.stringify({op:'subscribe',args:['publicTrade.BTCUSDT']}));
 s.onmessage({data:JSON.stringify(wire())});s.onmessage({data:JSON.stringify(wire())});expect(a.flatMap(v=>v.trades)).toHaveLength(1);expect(b.flatMap(v=>v.trades)).toHaveLength(1);
 s.onmessage({data:JSON.stringify(wire('a','Sell'))});expect(a.at(-1).status.state).toBe('reconnecting');expect(s.close).toHaveBeenCalledOnce();
 vi.advanceTimersByTime(500);expect(sockets).toHaveLength(2);
 releaseA();expect(sockets[1].close).not.toHaveBeenCalled();releaseB();expect(sockets[1].close).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);feed.dispose();
});
it('routes Binance perpetual and Bybit perpetual to distinct feeds and preserves selected tier scope',()=>{
 vi.useFakeTimers();const callbacks=new Map<string,Function>(),release=vi.fn(),events:any[]=[];
 const feed=(source:string)=>({subscribeExecutions(id:string,fn:Function){callbacks.set(source,fn);return release;}});
 const ticker=new TickerService({'binance:perpetual':feed('binance'),'bybit:perpetual':feed('bybit')} as any,e=>events.push(e),()=>now);
 ticker.subscribe('t',{markets:['binance:perpetual','bybit:perpetual']});expect(callbacks.size).toBe(2);
 const trade=parseBybitTrades(wire())[0];expect(classify(trade,tickerConfig({markets:['bybit:perpetual']}))).not.toBeNull();expect(classify(trade,tickerConfig({scope:['binance:perpetual']}))).toBeNull();
 const first=events[0];ticker.ack('t',first.generation,first.batchId);
 callbacks.get('bybit')!([trade],{state:'live',message:'Bybit',lastUpdate:now},now);ticker.flush();expect(events.at(-1).records[0].execution.venue).toBe('bybit');
 ticker.dispose();expect(release).toHaveBeenCalledTimes(2);
});
it('selects Bybit independently in CVD and positioning without changing existing defaults',()=>{
 expect(cvdSettings({}).sources).toEqual(['binance:spot','binance:perpetual']);expect(cvdSettings({sources:['bybit:perpetual']}).sources).toEqual(['bybit:perpetual']);
 expect(netPositioningSettings({venues:['binance','hyperliquid','bybit','bybit'],colors:{bybit:'#123456'}})).toMatchObject({venues:['binance','hyperliquid','bybit'],colors:{bybit:'#123456'}});
});
it('direct Bybit CVD uses only the Bybit feed and retains explicit connection gaps',()=>{
 vi.useFakeTimers();let callback:Function;const release=vi.fn(),events:any[]=[],binance=vi.fn();
 const cvd=new CvdService({perpetual:{subscribeExecutions:binance},'bybit:perpetual':{subscribeExecutions(_id,fn){callback=fn;return release;}}},e=>events.push(e),false,fetch,()=>now);
 cvd.subscribe('c',{sources:['bybit:perpetual'],anchor:'daily',origin:now-60000,custom:now-60000});expect(binance).not.toHaveBeenCalled();
 callback!([parseBybitTrades(wire())[0]],{state:'live',message:'live',lastUpdate:now},now-1000);expect(events.at(-1).series[0].source).toBe('bybit:perpetual');
 const event=events.at(-1);cvd.ack('c',event.generation,event.batchId);const live=events.at(-1);cvd.ack('c',live.generation,live.batchId);callback!([],{state:'reconnecting',message:'gap',lastUpdate:now},now-1000);expect(events.at(-1).series[0].coverage.gaps).toHaveLength(1);
 cvd.dispose();expect(release).toHaveBeenCalledOnce();
});

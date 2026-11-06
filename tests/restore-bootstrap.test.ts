import {test,expect,vi} from 'vitest';
import {startVisibleChartFeeds} from '../src/feed/restore-bootstrap';
const selection=(patch:any={})=>({venue:'binance',market:'perpetual',interval:'1h',type:'footprint',rowPrice:25,indicators:[],...patch}) as any;
function source(){const released:unknown[]=[],calls:unknown[][]=[];const sub=(...args:unknown[])=>{calls.push(args);return()=>released.push(args[0]);};return {feed:{subscribe:vi.fn(sub),subscribeFootprint:vi.fn(sub),subscribeOrderWalls:vi.fn(sub)} as any,calls,released};}
const layout=(panels:any,views:string[],activeView=views[0])=>({panels,grid:{root:{type:'leaf',data:{views,activeView}}}}) as any;
test('only active restored Binance charts start reads, with idempotent cleanup',()=>{
 const {feed,released}=source(),l=layout({a:{contentComponent:'candle',params:selection()},hidden:{contentComponent:'candle',params:selection()},hl:{contentComponent:'candle',params:selection({venue:'hyperliquid'})}},['a','hidden','hl']);
 const release=startVisibleChartFeeds(feed,l,x=>x as any);expect(feed.subscribe).toHaveBeenCalledTimes(1);expect(feed.subscribeFootprint).toHaveBeenCalledWith(expect.stringMatching(/^restore-\d+:footprint:a$/),expect.objectContaining({interval:'1h'}),25,expect.any(Function));expect(feed.subscribeOrderWalls).not.toHaveBeenCalled();release();release();expect(released).toHaveLength(2);
});
test('ordinary candle Totals and current Top Levels start without historical viewport work',()=>{
 const {feed}=source(),s=selection({type:'candle',indicators:[{definitionId:'native.footprint-totals',visible:true},{definitionId:'native.order-walls',visible:true,settings:{enabled:true,mode:'top-levels'}}]});
 const release=startVisibleChartFeeds(feed,layout({a:{contentComponent:'candle',params:s}},['a']),x=>x as any);expect(feed.subscribeFootprint).toHaveBeenCalledTimes(1);expect(feed.subscribeOrderWalls).toHaveBeenCalledWith(expect.stringMatching(/^restore-\d+:walls:a$/),expect.objectContaining({currentOnly:true,followLive:true}),expect.any(Function));release();
});
test('restore failure releases temporary consumers',()=>{const {feed,released}=source();const l={panels:{a:{contentComponent:'candle',params:selection()},b:{contentComponent:'candle',params:selection()}},grid:{root:{type:'branch',data:[{type:'leaf',data:{views:['a'],activeView:'a'}},{type:'leaf',data:{views:['b'],activeView:'b'}}]}}} as any;let count=0;expect(()=>startVisibleChartFeeds(feed,l,x=>{if(++count===2)throw Error('invalid restore');return x as any;})).toThrow('invalid restore');expect(released).toHaveLength(2);});

test('nested restore consumers use independent tokens while sharing canonical selections',()=>{const {feed,calls}=source(),l=layout({a:{contentComponent:'candle',params:selection()}},['a']);const a=startVisibleChartFeeds(feed,l,x=>x as any),b=startVisibleChartFeeds(feed,l,x=>x as any);expect(new Set(calls.map(call=>call[0])).size).toBe(4);a();b();});

test('early history demand uses saved footprint ranges and a bounded past range for ordinary Totals',()=>{
 const {feed}=source();feed.requestFootprintViewport=vi.fn();const now=Date.now(),saved={from:600000,to:3600000};
 const release=startVisibleChartFeeds(feed,layout({a:{contentComponent:'candle',params:selection({historyViewport:saved})}},['a']),x=>x as any,true);
 expect(feed.requestFootprintViewport).toHaveBeenCalledWith(expect.any(String),saved.from,saved.to);release();feed.requestFootprintViewport.mockClear();
 const totals=selection({type:'candle',historyViewport:saved,indicators:[{definitionId:'native.footprint-totals',visible:true}]});
 startVisibleChartFeeds(feed,layout({a:{contentComponent:'candle',params:totals}},['a']),x=>x as any,true)();
 const [,from,to]=feed.requestFootprintViewport.mock.calls[0];expect(to-from).toBe(4*3600000);expect(Math.abs(to-now)).toBeLessThan(3600000);
});

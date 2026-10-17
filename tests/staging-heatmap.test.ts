import {expect,test} from 'vitest';import {viewportRequest,heatmapTiles,mergeHeatmapResponses,mergePreparedSnapshot} from '../src/feed/staging-heatmap';import {heatmapBins} from '../src/chart/orderbook-heatmap';import {heatmapSettings} from '../src/feed/heatmap-model';
const preparedTile=(start:number,end:number,revision:number,bid=1)=>({preaggregated:true,timeMs:60000,id:`depth:${start}`,start,end,epoch:1,rowSize:25,revision,capacityLimited:false,cells:new Float64Array([81000,bid*60000,0,bid,0,60000,60000,60000,60000,bid*81000*60000,0,bid*81000,0]),peaks:new Float64Array()});
const activeView={from:0,to:300000,low:80990,high:81030};
test('incomplete prepared viewport snapshots retain valid overlap and current tiles until replacement',()=>{
 const historical=preparedTile(60000,120000,10),current=preparedTile(120000,180000,12),incoming=preparedTile(180000,210000,3);
 const merged=mergePreparedSnapshot([historical,current],[incoming],[{from:60000,to:120000,state:'ready'},{from:120000,to:180000,state:'building'}],activeView,60000,25,185000,false);
 expect(merged.map(b=>b.start)).toEqual([60000,120000,180000]);expect(merged.find(b=>b.start===60000)?.revision).toBe(10);expect(merged.find(b=>b.start===120000)?.revision).toBe(12);
 const gap=mergePreparedSnapshot([historical,current],[incoming],[{from:60000,to:120000,state:'gap'},{from:120000,to:180000,state:'building'}],activeView,60000,25,185000,false);
 expect(gap.map(b=>b.start)).toEqual([120000,180000]);
 const closed=preparedTile(120000,180000,13,2),revised=mergePreparedSnapshot([current],[closed],[{from:120000,to:180000,state:'ready'}],activeView,60000,25,185000,true);
 expect(revised).toHaveLength(1);expect(revised[0]?.revision).toBe(13);
});
test('prepared snapshots accept a confirmed empty replacement and age out an unclosed prior interval',()=>{
 const current=preparedTile(120000,180000,12),empty={...preparedTile(120000,180000,13),cells:new Float64Array()};
 const confirmed=mergePreparedSnapshot([current],[empty],[{from:120000,to:180000,state:'ready'}],activeView,60000,25,185000,true);
 expect(confirmed).toHaveLength(1);expect(confirmed[0]?.cells).toHaveLength(0);
 const rollover=mergePreparedSnapshot([current],[],[{from:180000,to:240000,state:'building'}],activeView,60000,25,180001,true);
 expect(rollover).toEqual([current]);
 const expired=mergePreparedSnapshot(rollover,[],[],activeView,60000,25,240001,true);
 expect(expired).toEqual([]);
});
test('viewport price/time resolutions bound display without limiting collection to near-price rows',()=>{const q=viewportRequest({from:100000,to:14500000,low:50000,high:150000,width:800,height:400},60000,1,14500000);expect((q.high-q.low)/q.rowPrice).toBeLessThanOrEqual(512);expect(Math.ceil((q.to-q.from)/q.timeMs)).toBeLessThanOrEqual(240);expect(q.rowPrice).toBeGreaterThan(128);expect(q.low).toBeLessThanOrEqual(50000);expect(q.high).toBeGreaterThanOrEqual(150000);});
test('historical tiles preserve means, simultaneous peaks, quote notionals and partial coverage',()=>{const data={watermark:9,resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:60000},cells:[{time:0,low:100,bid:2.5,ask:0,bidQuote:251.5,askQuote:0,bidPeak:3,askPeak:0,bidQuotePeak:303,askQuotePeak:0,bidDuration:60000,askDuration:60000,bidComplete:false,askComplete:true,epochs:[1]}]};const tiles=heatmapTiles(data,0,60000);const draw=(mode:'average'|'peak')=>heatmapBins(tiles,{...heatmapSettings(null),mode},60000,()=>0,i=>300+i*100,p=>200-p,800,500)[0]!;expect(draw('average').bid).toBe(2.5);expect(draw('average').bidQuote).toBe(251.5);expect(draw('peak').bid).toBe(3);expect(draw('peak').bidQuote).toBe(303);expect(draw('average').incomplete).toBe(true);});
test('server-resolved coarse time columns span their recorded host slots',()=>{const tiles=heatmapTiles({watermark:1,resolution:{timeMs:120000,rowPrice:10},coverage:{confirmedTo:120000},cells:[{time:0,low:100,bid:1,ask:null,bidQuote:100,askQuote:null,bidDuration:120000,askDuration:0,bidComplete:true,askComplete:false,epochs:[1]}]},0,120000);const b=heatmapBins(tiles,heatmapSettings(null),60000,()=>0,i=>100+i*40,p=>200-p,800,500)[0]!;expect(b.right-b.x).toBe(80);expect(b.columnEnd).toBe(120000);expect(b.askObserved).toBe(false);});

test('partial observed time uses its actual duration and preserves known zero',()=>{const data={watermark:1,resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:60000},cells:[{time:0,low:100,bid:5,ask:0,bidQuote:500,askQuote:0,bidPeak:6,askPeak:0,bidQuotePeak:600,askQuotePeak:0,bidDuration:30000,askDuration:60000,bidComplete:false,askComplete:true,epochs:[1]}]};const tiles=heatmapTiles(data,0,60000);const b=heatmapBins(tiles,heatmapSettings(null),60000,()=>0,i=>300+i*100,p=>200-p,800,500)[0]!;expect(b.bid).toBe(5);expect(b.ask).toBe(0);expect(b.bidObserved).toBe(true);expect(b.askObserved).toBe(true);expect(b.incomplete).toBe(true);});

import {vi,beforeEach,afterEach} from 'vitest';beforeEach(()=>vi.stubEnv('VITE_HISTORY_TILES','0'));afterEach(()=>vi.unstubAllEnvs());import {StagingHeatmapService} from '../src/feed/staging-heatmap';
test('Spot depth history and live subscription use the Spot feed identity and tick size',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10_000_000);const calls:string[]=[],socketUrls:string[]=[],sockets:any[]=[],spotFeed='binance:spot:BTCUSDT:spot-diff-depth';
 const request:any=async(url:string)=>{calls.push(url);const q=new URL(url,'http://localhost').searchParams;return new Response(JSON.stringify({version:1,source:spotFeed,watermark:1,resolution:{timeMs:Number(q.get('timeMs')),rowPrice:Number(q.get('rowPrice'))},coverage:{from:Number(q.get('from')),to:Number(q.get('to')),confirmedTo:Date.now(),epochs:[],gaps:[]},status:{state:'live'},cells:[],availability:[]}));};
 const socket=(url:string)=>{socketUrls.push(url);const ws:any={send:vi.fn(),close:vi.fn()};sockets.push(ws);return ws;};
 const events:any[]=[],cache={read:async()=>undefined,write:async()=>{}};const service=new StagingHeatmapService(e=>events.push(e),request,()=>Date.now(),socket,cache as any);
 try{service.command({type:'heatmap-subscribe',id:'spot',market:'spot',resolution:{rowPrice:25,bucketMs:500,candleMs:60000}});service.command({type:'heatmap-viewport',id:'spot',viewport:{from:9_880_000,to:10_000_000,low:83_000,high:83_100,width:800,height:400}});await vi.advanceTimersByTimeAsync(500);
  expect(calls.length).toBeGreaterThan(0);expect(calls.every(url=>new URL(url,'http://localhost').searchParams.get('market')==='spot')).toBe(true);expect(service.diagnostics().groups[0]).toMatchObject({market:'spot'});expect(events.at(-1).status.tickSize).toBe(.01);expect(service.diagnostics().groups[0]?.status?.tickSize).toBe(.01);
  expect(sockets).toHaveLength(1);expect(new URL(socketUrls[0]!).pathname).toBe('/market-data/v1/stream');expect(new URL(socketUrls[0]!).searchParams.get('market')).toBe('spot');sockets[0].onopen?.();expect(JSON.parse(sockets[0].send.mock.calls[0]![0])).toMatchObject({type:'subscribe',channel:'depth',market:'spot'});
 }finally{service.dispose();vi.useRealTimers();}
});
test('worker coalesces resolved viewport motion, shares one stream and replaces live overlap',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);let s:StagingHeatmapService|undefined;let now=10000000,cursor=1,quantity=5,requests=0;const packets:any[]=[],socketUrls:string[]=[],sockets:any[]=[];
 const socket=(url:string)=>{socketUrls.push(url);const ws:any={send:vi.fn(),close:vi.fn()};sockets.push(ws);return ws;};
 const request:any=async()=>{requests++;return new Response(JSON.stringify({version:1,source:'usd-m-standard-diff-depth-rpi-excluded',watermark:cursor,resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:now,epochs:[{from:9900000}],gaps:[]},status:{state:'live'},cells:[{time:9960000,low:1000,bid:quantity,ask:0,bidQuote:quantity*1000,askQuote:0,bidDuration:40000,askDuration:40000,bidComplete:true,askComplete:true,epochs:[1]}]}));};
 try{s=new StagingHeatmapService(e=>{packets.push(e);if(e.type==='heatmap-batch')s?.command({type:'heatmap-ack',key:e.key,generation:e.generation,batchId:e.batchId});},request,()=>Date.now(),socket);
 const view={from:9900000,to:10010000,low:1002,high:1102,width:800,height:400};s.command({type:'heatmap-subscribe',id:'a',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'a',viewport:view});await vi.advanceTimersByTimeAsync(500);expect(requests).toBe(1);expect(new URL(socketUrls[0]!).searchParams.has('market')).toBe(false);
 s.command({type:'heatmap-viewport',id:'a',viewport:{...view,low:1002.01,high:1102.01}});await vi.advanceTimersByTimeAsync(500);expect(requests).toBe(1);
 s.command({type:'heatmap-subscribe',id:'b',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'b',viewport:view});await vi.advanceTimersByTimeAsync(500);expect(sockets).toHaveLength(1);
 quantity=6;cursor=2;sockets[0].onmessage({data:JSON.stringify({type:'depth-head',watermark:{cursor,at:now}})});await vi.advanceTimersByTimeAsync(500);
 const last=packets.filter(e=>e.ids[0]==='a'&&e.buckets.length).at(-1);expect(last.buckets).toHaveLength(1);expect(last.buckets[0].cells[1]/40000).toBe(6);expect(sockets[0].send).toHaveBeenCalledWith(JSON.stringify({type:'ack',cursor:2}));
 s.dispose();expect(sockets[0].close).toHaveBeenCalled();}finally{s?.dispose();vi.useRealTimers();}
});

test('worker discards history responses after subscription disposal',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);let resolve:any;const events:any[]=[];const request:any=()=>new Promise(r=>resolve=r);const s=new StagingHeatmapService(e=>events.push(e),request,()=>Date.now(),()=>({close(){}} as any));try{
 s.command({type:'heatmap-subscribe',id:'a',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'a',viewport:{from:9900000,to:10010000,low:1000,high:1100,width:800,height:400}});await vi.advanceTimersByTimeAsync(500);s.command({type:'heatmap-unsubscribe',id:'a'});const before=events.length;resolve(new Response(JSON.stringify({version:1,cells:[],watermark:1})));await vi.advanceTimersByTimeAsync(500);expect(events).toHaveLength(before);expect(s.diagnostics().configurations).toBe(0);
 }finally{s.dispose();vi.useRealTimers();}
});

test('partial coarse history anchors to its bucket opening rather than first observed minute',()=>{const tiles=heatmapTiles({watermark:1,resolution:{timeMs:120000,rowPrice:10},coverage:{confirmedTo:120000},cells:[{time:0,low:100,bid:1,ask:null,bidQuote:100,askQuote:null,bidDuration:60000,askDuration:0,bidComplete:false,askComplete:false,epochs:[1]}]},60000,120000);const b=heatmapBins(tiles,heatmapSettings(null),60000,t=>t===0?0:undefined,i=>100+i*40,p=>200-p,800,500)[0]!;expect(b).toBeDefined();expect(b.x).toBe(80);expect(b.right).toBe(160);expect(b.partial).toBe(true);});

test('paints recent liquidity before full history, then replaces overlap without adding quantities',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);const packets:any[]=[],ranges:any[]=[],sockets:any[]=[];let resolveHistory:any,s:StagingHeatmapService|undefined;
 const data=(from:number,to:number,quantity:number,cursor:number)=>({version:1,source:'usd-m-standard-diff-depth-rpi-excluded',watermark:cursor,resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:to,epochs:[{from:9000000}],gaps:[]},status:{state:'live'},cells:[...new Set([Math.floor(from/60000)*60000,9900000])].map(time=>({time,low:1000,bid:quantity,ask:0,bidQuote:quantity*1000,askQuote:0,bidDuration:60000,askDuration:60000,bidComplete:true,askComplete:true,epochs:[1]}))});
 const request:any=async(url:string)=>{const p=new URL(url,'http://localhost').searchParams,range={from:Number(p.get('from')),to:Number(p.get('to'))};ranges.push(range);if(ranges.length===2)return new Promise(r=>resolveHistory=()=>r(new Response(JSON.stringify(data(range.from,range.to,7,11)))));return new Response(JSON.stringify(data(range.from,range.to,5,10)));};
 try{s=new StagingHeatmapService(e=>{packets.push(e);if(e.type==='heatmap-batch')s?.command({type:'heatmap-ack',key:e.key,generation:e.generation,batchId:e.batchId});},request,()=>Date.now(),()=>{const ws:any={send:vi.fn(),close:vi.fn()};sockets.push(ws);return ws;});s.command({type:'heatmap-subscribe',id:'a',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'a',viewport:{from:9600000,to:10010000,low:1000,high:1100,width:800,height:400}});await vi.advanceTimersByTimeAsync(500);
 expect(ranges).toHaveLength(2);expect(Math.ceil(ranges[0].to/60000)-ranges[0].from/60000).toBe(2);expect(ranges[1].from).toBeLessThan(ranges[0].from);expect(packets.at(-1).status.state).toBe('syncing');expect(packets.at(-1).buckets).toHaveLength(1);expect(sockets).toHaveLength(1);
 resolveHistory();await vi.advanceTimersByTimeAsync(0);const full=packets.at(-1);expect(full.status.state).toBe('live');expect(full.buckets[0].cells[1]/60000).toBe(7);expect(full.buckets[0].revision).toBe(11);expect(full.buckets.find((b:any)=>b.start===9900000).cells[1]/60000).toBe(7);expect(new Set(full.buckets.map((b:any)=>b.id)).size).toBe(full.buckets.length);
 }finally{s?.dispose();vi.useRealTimers();}
});

test('capacity contention backs off rather than flooding the shared server',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);let count=0;const request:any=async()=>{count++;return new Response(JSON.stringify({error:'Depth aggregation capacity; retry'}),{status:400});};const s=new StagingHeatmapService(()=>{},request,()=>Date.now());try{s.command({type:'heatmap-subscribe',id:'a',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'a',viewport:{from:9900000,to:10010000,low:1000,high:1100,width:800,height:400}});await vi.advanceTimersByTimeAsync(2000);expect(count).toBe(3);}finally{s.dispose();vi.useRealTimers();}
});

import {cachedTiles,type CachedHeatmap} from '../src/feed/heatmap-cache';
const savedHistory=():CachedHeatmap=>({version:1,savedAt:9999000,rowPrice:10,timeMs:60000,buckets:[{id:'depth:9900000',start:9900000,end:9960000,epoch:1,rowSize:10,timeMs:60000,preaggregated:true,revision:8,capacityLimited:false,cells:new Float64Array([1000,120000,0,2,0,60000,60000,0,60000,120000000,0,2000,0]),peaks:new Float64Array()}]});
test('closed tile cache preserves partial coverage and zeros, rejecting stale or live state',()=>{
 const bounds={from:9800000,to:10000001,low:1000,high:1010,rowPrice:10,timeMs:60000},saved=savedHistory(),out=cachedTiles(saved,bounds,10000000);expect(out).toHaveLength(1);expect(Array.from(out[0].cells)).toEqual(Array.from(saved.buckets[0].cells));expect(out[0].cells[7]).toBe(0);expect(out[0].cells[2]).toBe(0);
 expect(cachedTiles({...saved,savedAt:9600000},bounds,10000000)).toEqual([]);expect(cachedTiles(saved,{...bounds,rowPrice:25},10000000)).toEqual([]);expect(cachedTiles({...saved,buckets:[{...saved.buckets[0],end:10000000}]},bounds,10000000)).toEqual([]);expect(cachedTiles(saved,{...bounds,low:1100,high:1200},10000000)).toEqual([]);
});
test('cached history paints before network completion and is replaced by validated server tiles',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);let resolve:any,s:StagingHeatmapService|undefined;const events:any[]=[],cache={read:vi.fn(async()=>savedHistory()),write:vi.fn(async()=>{})};const request:any=()=>new Promise(r=>resolve=r);
 try{s=new StagingHeatmapService(e=>{events.push(e);if(e.type==='heatmap-batch')s?.command({type:'heatmap-ack',key:e.key,generation:e.generation,batchId:e.batchId});},request,()=>Date.now(),()=>({send(){},close(){}} as any),cache);s.command({type:'heatmap-subscribe',id:'a',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'a',viewport:{from:9900000,to:10010000,low:1002,high:1102,width:800,height:400}});await vi.advanceTimersByTimeAsync(500);expect(events.at(-1).status.message).toContain('cached closed history');expect(events.at(-1).status.state).toBe('syncing');expect(events.at(-1).buckets[0].revision).toBe(8);
 resolve(new Response(JSON.stringify({version:1,source:'usd-m-standard-diff-depth-rpi-excluded',watermark:9,resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:10000000,epochs:[{from:9900000}],gaps:[]},status:{state:'live'},cells:[{time:9900000,low:1000,bid:4,ask:0,bidQuote:4000,askQuote:0,bidDuration:60000,askDuration:60000,bidComplete:false,askComplete:true,epochs:[1]}]})));await vi.advanceTimersByTimeAsync(0);expect(events.at(-1).buckets).toHaveLength(1);expect(events.at(-1).buckets[0].cells[1]/60000).toBe(4);expect(events.at(-1).status.state).toBe('live');expect(cache.write).toHaveBeenCalled();
 }finally{s?.dispose();vi.useRealTimers();}
});

test('fragmented coarse columns conserve duration-weighted means, quote totals, peaks and unknowns',()=>{
 const page=(from:number,to:number,bid:number|null,duration:number)=>({watermark:17,resolution:{timeMs:3600000,rowPrice:10},coverage:{from,to,confirmedTo:3600000,epochs:[{epoch:1,from:1,to:3600000}],gaps:[]},cells:[{time:0,low:100,high:110,bid,ask:0,bidQuote:bid===null?null:bid*105,askQuote:0,bidPeak:bid,askPeak:0,bidQuotePeak:bid===null?null:bid*105,askQuotePeak:0,bidDuration:duration,askDuration:to-from,bidComplete:bid!==null,askComplete:true,epochs:[1]}]});
 const a=page(1,600001,2,600000),b=page(600001,1800001,8,1200000);const cell=mergeHeatmapResponses(a,b).cells[0];
 expect(cell.bid).toBe(6);expect(cell.bidQuote).toBe(630);expect(cell.bidDuration).toBe(1800000);expect(cell.bidPeak).toBe(8);expect(cell.ask).toBe(0);expect(cell.askDuration).toBe(1800000);
 const partial=mergeHeatmapResponses(a,page(600001,1800001,null,0)).cells[0];expect(partial.bid).toBe(2);expect(partial.bidDuration).toBe(600000);expect(partial.bidComplete).toBe(false);expect(()=>mergeHeatmapResponses(a,{...b,watermark:18})).toThrow('watermark');
});

test('panels serialize replay work so a second panel cannot occupy another server slot',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);let resolve:any;const calls:string[]=[];const data={version:1,source:'usd-m-standard-diff-depth-rpi-excluded',watermark:1,resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:10000000,epochs:[],gaps:[]},status:{state:'live'},cells:[]};
 const request:any=async(url:string)=>{calls.push(url);if(calls.length===1)return new Promise(r=>resolve=()=>r(new Response(JSON.stringify(data))));return new Response(JSON.stringify(data));};const s=new StagingHeatmapService(()=>{},request,()=>Date.now(),()=>({send(){},close(){}} as any));
 try{for(const id of ['a','b']){s.command({type:'heatmap-subscribe',id,resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id,viewport:{from:9900000,to:10010000,low:1000,high:1100,width:800,height:400}});}
 await vi.advanceTimersByTimeAsync(1000);expect(calls).toHaveLength(1);resolve();await vi.advanceTimersByTimeAsync(1000);expect(calls).toHaveLength(2);
 }finally{s.dispose();vi.useRealTimers();}
});

test('wide replay fragments share a captured durable head and stay within twenty-minute pages',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);const calls:URLSearchParams[]=[];let s:StagingHeatmapService|undefined;const events:any[]=[];
 const request:any=async(url:string)=>{const q=new URL(url,'http://localhost').searchParams;calls.push(q);const from=Number(q.get('from')),to=Number(q.get('to'));return new Response(JSON.stringify({version:1,source:'usd-m-standard-diff-depth-rpi-excluded',watermark:Number(q.get('watermark')??calls.length),resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:10000000,epochs:[],gaps:[]},status:{state:'live'},cells:[]}));};
 try{s=new StagingHeatmapService(e=>{events.push(e);if(e.type==='heatmap-batch')s?.command({type:'heatmap-ack',key:e.key,generation:e.generation,batchId:e.batchId});},request,()=>Date.now(),()=>({send(){},close(){}} as any));s.command({type:'heatmap-subscribe',id:'a',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'a',viewport:{from:7600000,to:10010000,low:1000,high:1100,width:800,height:400}});await vi.advanceTimersByTimeAsync(500);
 expect(calls.length).toBeGreaterThan(3);expect(calls.every(q=>Number(q.get('to'))-Number(q.get('from'))<=1200000)).toBe(true);expect(calls.slice(2).every(q=>q.get('watermark')==='2')).toBe(true);expect(events.at(-1).status.state).toBe('live');
 }finally{s?.dispose();vi.useRealTimers();}
});

test('historical fragments paint progressively and resume a failed page at the original watermark',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);const calls:URLSearchParams[]=[],events:any[]=[];let s:StagingHeatmapService|undefined,release:any;
 const request:any=async(url:string)=>{const q=new URL(url,'http://localhost').searchParams;calls.push(q);const from=Number(q.get('from')),to=Number(q.get('to')),watermark=Number(q.get('watermark')??calls.length);
  if(calls.length===3)return new Response(JSON.stringify({error:'Transient query failure'}),{status:503});
  if(calls.length===4)await new Promise(r=>release=r);
  const cells=[];for(let time=Math.floor(from/60000)*60000;time<to;time+=60000){const duration=Math.min(time+60000,to)-Math.max(time,from);cells.push({time,low:1000,bid:watermark,ask:0,bidQuote:1000*watermark,askQuote:0,bidPeak:watermark,askPeak:0,bidDuration:duration,askDuration:duration,bidComplete:true,askComplete:true,epochs:[1]});}
  return new Response(JSON.stringify({version:1,source:'usd-m-standard-diff-depth-rpi-excluded',watermark,resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:10000000,epochs:[{epoch:1,from:1}],gaps:[]},status:{state:'live'},cells}));};
 try{s=new StagingHeatmapService(e=>{events.push(e);if(e.type==='heatmap-batch')s?.command({type:'heatmap-ack',key:e.key,generation:e.generation,batchId:e.batchId});},request,()=>Date.now(),()=>({send(){},close(){}} as any));s.command({type:'heatmap-subscribe',id:'a',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'a',viewport:{from:8200000,to:10010000,low:1000,high:1100,width:800,height:400}});
  await vi.advanceTimersByTimeAsync(500);expect(calls).toHaveLength(3);
  const partial=events.find(e=>e.status.message.includes('loading history '));expect(partial).toBeDefined();expect(partial.buckets.length).toBeGreaterThan(2);expect(partial.buckets[0].revision).toBe(2);expect(partial.buckets.at(-1).revision).toBe(1);
  expect(events.at(-1).status.state).toBe('stale');expect(events.at(-1).buckets).toEqual(partial.buckets);
  await vi.advanceTimersByTimeAsync(1000);expect(calls).toHaveLength(4);expect(calls[3].toString()).toBe(calls[2].toString());expect(calls[3].get('watermark')).toBe('2');
  release();await vi.advanceTimersByTimeAsync(0);const full=events.at(-1);expect(full.status.state).toBe('live');expect(full.buckets.every((b:any)=>b.revision===2)).toBe(true);expect(calls.slice(2).every(q=>q.get('watermark')==='2')).toBe(true);expect(new Set(full.buckets.map((b:any)=>b.id)).size).toBe(full.buckets.length);
 }finally{s?.dispose();vi.useRealTimers();}
});

test('viewport replacement discards unfinished historical progress and its watermark',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);const calls:URLSearchParams[]=[],events:any[]=[];let s:StagingHeatmapService|undefined,release:any;
 const response=(q:URLSearchParams,watermark:number)=>new Response(JSON.stringify({version:1,source:'usd-m-standard-diff-depth-rpi-excluded',watermark,resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:10000000,epochs:[],gaps:[]},status:{state:'live'},cells:[]}));
 const request:any=async(url:string)=>{const q=new URL(url,'http://localhost').searchParams;calls.push(q);if(calls.length===3)return new Promise(r=>release=()=>r(response(q,2)));return response(q,Number(q.get('watermark')??calls.length));};
 try{s=new StagingHeatmapService(e=>{events.push(e);if(e.type==='heatmap-batch')s?.command({type:'heatmap-ack',key:e.key,generation:e.generation,batchId:e.batchId});},request,()=>Date.now(),()=>({send(){},close(){}} as any));s.command({type:'heatmap-subscribe',id:'a',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'a',viewport:{from:8200000,to:10010000,low:1000,high:1100,width:800,height:400}});await vi.advanceTimersByTimeAsync(500);expect(calls).toHaveLength(3);
  s.command({type:'heatmap-viewport',id:'a',viewport:{from:9900000,to:10010000,low:2000,high:2100,width:800,height:400}});const before=events.length;release();await vi.advanceTimersByTimeAsync(0);expect(events).toHaveLength(before);await vi.advanceTimersByTimeAsync(500);expect(calls).toHaveLength(4);expect(calls[3].has('watermark')).toBe(false);expect(Number(calls[3].get('low'))).toBeGreaterThan(1900);expect(events.at(-1).status.state).toBe('live');
 }finally{s?.dispose();vi.useRealTimers();}
});

test.each(['Depth replay byte budget exceeded; request a smaller time range','Worker terminated due to reaching memory limit: JS heap out of memory','Depth aggregation resource limit'])('replay fragments halve after %s without skipping history or changing the head',async(error)=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);const calls:URLSearchParams[]=[];let s:StagingHeatmapService|undefined;
 const request:any=async(url:string)=>{const q=new URL(url,'http://localhost').searchParams;calls.push(q);if(calls.length===2)return new Response(JSON.stringify({error}),{status:400});return new Response(JSON.stringify({version:1,source:'usd-m-standard-diff-depth-rpi-excluded',watermark:Number(q.get('watermark')??calls.length),resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:10000000,epochs:[],gaps:[]},status:{state:'live'},cells:[]}));};
 try{s=new StagingHeatmapService(e=>{if(e.type==='heatmap-batch')s?.command({type:'heatmap-ack',key:e.key,generation:e.generation,batchId:e.batchId});},request,()=>Date.now(),()=>({send(){},close(){}} as any));s.command({type:'heatmap-subscribe',id:'a',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'a',viewport:{from:7600000,to:10010000,low:1000,high:1100,width:800,height:400}});await vi.advanceTimersByTimeAsync(500);
  expect(Number(calls[1].get('to'))-Number(calls[1].get('from'))).toBe(1200000);expect(calls[2].get('from')).toBe(calls[1].get('from'));expect(Number(calls[2].get('to'))-Number(calls[2].get('from'))).toBe(600000);
  expect(calls.slice(3).every(q=>q.get('watermark')==='3')).toBe(true);for(let i=3;i<calls.length;i++)expect(calls[i].get('from')).toBe(calls[i-1].get('to'));expect(s.diagnostics().groups[0].status?.state).toBe('live');
 }finally{s?.dispose();vi.useRealTimers();}
});

test('an expired retained watermark restarts unfinished history at a fresh head',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000000);const calls:URLSearchParams[]=[];let s:StagingHeatmapService|undefined;
 const request:any=async(url:string)=>{const q=new URL(url,'http://localhost').searchParams;calls.push(q);if(calls.length===2)return new Response(JSON.stringify({error:'Depth watermark not retained'}),{status:400});return new Response(JSON.stringify({version:1,source:'usd-m-standard-diff-depth-rpi-excluded',watermark:Number(q.get('watermark')??calls.length),resolution:{timeMs:60000,rowPrice:10},coverage:{confirmedTo:10000000,epochs:[],gaps:[]},status:{state:'live'},cells:[]}));};
 try{s=new StagingHeatmapService(e=>{if(e.type==='heatmap-batch')s?.command({type:'heatmap-ack',key:e.key,generation:e.generation,batchId:e.batchId});},request,()=>Date.now(),()=>({send(){},close(){}} as any),{read:async()=>savedHistory(),write:async()=>{}});s.command({type:'heatmap-subscribe',id:'a',resolution:{rowPrice:10,bucketMs:500,candleMs:60000}});s.command({type:'heatmap-viewport',id:'a',viewport:{from:7600000,to:10010000,low:1000,high:1100,width:800,height:400}});await vi.advanceTimersByTimeAsync(500);expect(calls).toHaveLength(2);expect(calls[1].get('watermark')).toBe('1');
  await vi.advanceTimersByTimeAsync(1000);expect(calls[2].has('watermark')).toBe(false);expect(calls[2].get('from')).toBe(calls[0].get('from'));expect(calls.slice(3).every(q=>q.get('watermark')==='3')).toBe(true);expect(s.diagnostics().groups[0].status?.state).toBe('live');
 }finally{s?.dispose();vi.useRealTimers();}
});

test('a full four-hour viewport retains both edges instead of spending its budget on off-screen margin',()=>{const from=1791877200000,to=from+14400000;const q=viewportRequest({from,to,low:82910,high:84330,width:1500,height:900},300000,10,to+3600000);expect(q.from).toBe(from);expect(q.to).toBe(to);expect(q.rowPrice).toBe(10);expect(q.timeMs).toBe(300000);});

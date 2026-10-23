import { describe, expect, it } from 'vitest';
import { DEFAULT_DEPTH_MATRIX_SETTINGS } from '../src/feed/depth-matrix';
import { StagingDepthMatrixService } from '../src/feed/staging-depth-matrix';
import type { DepthHeadNotice, StagingHeatmapService } from '../src/feed/staging-heatmap';

type Observer={market:'spot'|'perpetual';callback:(notice:DepthHeadNotice)=>void};
function headHarness(){const observers=new Map<string,Observer>();let releases=0;const heads={observeDepthHeads(id:string,market:Observer['market'],_after:number,callback:Observer['callback']){observers.set(id,{market,callback});return()=>{releases++;observers.delete(id);};}};return{heads,observers,get releases(){return releases;}};}
type Call={url:string;signal:AbortSignal|null;resolve:(response:Response)=>void};
function deferredRequest(){const calls:Call[]=[];const request:typeof fetch=(input,init)=>new Promise<Response>(resolve=>calls.push({url:String(input),signal:init?.signal??null,resolve}));return{calls,request};}
function response(body:unknown){return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});}
function snapshotFor(url:string,at:number,cursor=2,epoch=4){
  const params=new URL(url,'http://unit.test').searchParams,market=params.get('market')==='spot'?'spot':'perpetual';
  const width=Number(params.get('width')??100),low=params.get('low')??String(Math.floor(9_900/width)*width),high=params.get('high')??String(Number(low)+width*2);
  const rows=[];for(let p=Number(low);p<Number(high);p+=width)rows.push({index:String(p/width),low:String(p),high:String(p+width),bidQuantity:p===9900?1.25:0,askQuantity:p===10000?2.5:0,
    bidNotional:p===9900?12375:0,askNotional:p===10000?25000:0,bidCoverage:'observed',askCoverage:p===10000?'observed':'known-empty'});
  return{version:1,source:market==='spot'?'binance:spot:BTCUSDT:spot-diff-depth':'usd-m-standard-diff-depth-rpi-excluded',market,
    instrument:`binance:${market}:BTCUSDT`,feed:market==='spot'?'binance:spot:BTCUSDT:spot-diff-depth':'usd-m-standard-diff-depth-rpi-excluded',
    state:'live',message:'Durable synchronized depth',cursor,epoch,at,lastAt:at,ageMs:0,width:String(params.get('width')??100),viewport:{low,high},rows,bestBid:'9999',bestAsk:'10001',mid:'10000',quantityUnit:'BTC',notionalUnit:'USDT'};
}
async function waitFor(predicate:()=>boolean){for(let i=0;i<500;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('Timed out waiting for depth matrix work');}
function pageCall(api:ReturnType<typeof deferredRequest>,low:string,high:string,market:'spot'|'perpetual'='perpetual'){
  return api.calls.find(call=>{const params=new URL(call.url,'http://unit.test').searchParams;return params.get('low')===low&&params.get('high')===high&&(params.get('market')==='spot'?'spot':'perpetual')===market;});
}
function settings(){return{...DEFAULT_DEPTH_MATRIX_SETTINGS,sources:['binance-perpetual']};}

describe('staging depth matrix compact snapshot lifecycle',()=>{
  it('coalesces one current-book grid and fans its visible rows out to two widgets',async()=>{
    const stream=headHarness(),api=deferredRequest(),events:Array<Extract<import('../src/feed/protocol').Event,{type:'depth-matrix-batch'}>>=[];
    const service=new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService,event=>events.push(event),api.request,()=>10_000);
    service.command({type:'depth-matrix-subscribe',id:'one',settings:settings()});service.command({type:'depth-matrix-subscribe',id:'two',settings:settings()});
    expect(stream.observers.size).toBe(1);expect(service.diagnostics()).toMatchObject({activeWidgets:2,activeMarkets:1});
    [...stream.observers.values()][0]!.callback({type:'head',cursor:2,at:9_999,epoch:4});await waitFor(()=>api.calls.length===1);
    const params=new URL(api.calls[0]!.url,'http://unit.test').searchParams;expect(api.calls[0]!.url).toContain('/depth-matrix?');expect(params.get('width')).toBe('100');expect(params.has('after')).toBe(false);
    api.calls[0]!.resolve(response(snapshotFor(api.calls[0]!.url,9_999)));await waitFor(()=>events.length===2);
    expect(events[0]!.columns[0]).toMatchObject({source:'binance-perpetual',state:'live',cursor:2,quantityUnit:'BTC'});
    expect(events[0]!.columns[0]!.rows.some(row=>row.bidQuantity===1.25&&row.bidNotional===12375)).toBe(true);
    expect(events[0]!.viewport).toEqual({low:'9900',high:'10100'});
    expect(api.calls).toHaveLength(3);expect(service.diagnostics()).toMatchObject({requests:3,activeGrids:3});
    service.command({type:'depth-matrix-unsubscribe',id:'one'});expect(stream.observers.size).toBe(1);
    service.command({type:'depth-matrix-unsubscribe',id:'two'});expect(stream.observers.size).toBe(0);expect(service.diagnostics()).toMatchObject({activeWidgets:0,activeMarkets:0,activeGrids:0});service.dispose();
  });

  it('aborts an old cursor request on reset and accepts only the fresh cursor',async()=>{
    const stream=headHarness(),api=deferredRequest(),events:Array<Extract<import('../src/feed/protocol').Event,{type:'depth-matrix-batch'}>>=[];let clock=10_000;
    const service=new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService,event=>events.push(event),api.request,()=>clock);
    service.command({type:'depth-matrix-subscribe',id:'one',settings:settings()});const notify=[...stream.observers.values()][0]!.callback;
    notify({type:'head',cursor:2,at:9_999,epoch:4});await waitFor(()=>api.calls.length===1);notify({type:'reset',message:'collector reset'});expect(api.calls[0]!.signal?.aborted).toBe(true);
    await waitFor(()=>events.some(event=>event.columns[0]?.state==='syncing'));expect(events.at(-1)!.columns[0]!.rows).toEqual([]);
    clock+=160;notify({type:'head',cursor:3,at:10_100,epoch:5});await waitFor(()=>api.calls.length===2);
    const fresh=snapshotFor(api.calls[1]!.url,10_100,3,5);api.calls[1]!.resolve(response(fresh));await waitFor(()=>service.diagnostics().markets[0]?.cursor===3);
    api.calls[0]!.resolve(response(snapshotFor(api.calls[0]!.url,9_999,2,4)));await new Promise(resolve=>setTimeout(resolve,0));
    expect(service.diagnostics().markets[0]).toMatchObject({cursor:3,epoch:5,state:'live'});service.dispose();
  });

  it('lets the current snapshot finish while neighbor prefetch remains one-shot across a newer head',async()=>{
    const stream=headHarness(),api=deferredRequest(),events:Array<Extract<import('../src/feed/protocol').Event,{type:'depth-matrix-batch'}>>=[];
    let clock=10_000;const service=new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService,event=>events.push(event),api.request,()=>clock);
    service.command({type:'depth-matrix-subscribe',id:'one',settings:settings()});const notify=[...stream.observers.values()][0]!.callback;
    notify({type:'head',cursor:2,at:9_999,epoch:4});await waitFor(()=>api.calls.length===1);
    notify({type:'head',cursor:3,at:10_000,epoch:4});expect(api.calls.length).toBe(1);expect(api.calls[0]!.signal?.aborted).toBe(false);
    api.calls[0]!.resolve(response(snapshotFor(api.calls[0]!.url,10_000,3,4)));await waitFor(()=>events.length>0&&api.calls.length===3);
    expect(events.at(-1)!.columns[0]).toMatchObject({state:'live',cursor:3});
    const neighbor=pageCall(api,'10000','10200')!;notify({type:'head',cursor:4,at:10_050,epoch:4});
    const active=await waitFor(()=>pageCall(api,'9900','10100')!==undefined).then(()=>pageCall(api,'9900','10100')!);
    active.resolve(response(snapshotFor(active.url,10_050,4,4)));
    neighbor.resolve(response(snapshotFor(neighbor.url,10_050,3,4)));
    await new Promise(resolve=>setTimeout(resolve,220));expect(api.calls).toHaveLength(4);service.dispose();
  });

  it('rejects snapshots whose rows do not match the requested exact bucket grid',async()=>{
    const stream=headHarness(),api=deferredRequest(),events:Array<Extract<import('../src/feed/protocol').Event,{type:'depth-matrix-batch'}>>=[];
    const service=new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService,event=>events.push(event),api.request,()=>10_000);
    service.command({type:'depth-matrix-subscribe',id:'one',settings:settings()});[...stream.observers.values()][0]!.callback({type:'head',cursor:2,at:9_999,epoch:4});
    await waitFor(()=>api.calls.length===1);const malformed=snapshotFor(api.calls[0]!.url,9_999);malformed.rows[0]!.high='10001';
    api.calls[0]!.resolve(response(malformed));await waitFor(()=>service.diagnostics().failures===1);await waitFor(()=>events.some(event=>event.columns[0]?.state==='stale'));
    expect(events.at(-1)!.columns[0]!.rows).toEqual([]);service.dispose();
  });

  it('keeps offline values marked disconnected and revalidates a fresh same-epoch book on reconnect',async()=>{
    const stream=headHarness(),api=deferredRequest(),events:Array<Extract<import('../src/feed/protocol').Event,{type:'depth-matrix-batch'}>>=[];let clock=10_000;
    const service=new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService,event=>events.push(event),api.request,()=>clock);
    service.command({type:'depth-matrix-subscribe',id:'one',settings:settings()});expect(stream.observers.size).toBe(1);
    [...stream.observers.values()][0]!.callback({type:'head',cursor:2,at:9_999,epoch:4});await waitFor(()=>api.calls.length===1);
    api.calls[0]!.resolve(response(snapshotFor(api.calls[0]!.url,9_999)));await waitFor(()=>events.some(event=>event.columns[0]?.state==='live'));
    const before=events.at(-1)!.columns[0]!;expect(before.rows.some(row=>row.bidQuantity>0&&row.bidCoverage==='observed')).toBe(true);
    clock+=160;service.setOnline(false);expect(stream.observers.size).toBe(0);await waitFor(()=>events.some(event=>event.columns[0]?.state==='disconnected'));
    const offline=events.at(-1)!.columns[0]!;expect(offline.rows.some(row=>row.bidQuantity>0&&row.bidCoverage==='disconnected')).toBe(true);
    clock+=160;service.setOnline(true);expect(stream.observers.size).toBe(1);expect(service.diagnostics()).toMatchObject({activeMarkets:1});
    [...stream.observers.values()][0]!.callback({type:'head',cursor:3,at:clock,epoch:4});await waitFor(()=>pageCall(api,'9900','10100')!==undefined);
    await waitFor(()=>events.some(event=>event.columns[0]?.state==='live'&&event.columns[0]?.cursor===2));
    const refreshed=pageCall(api,'9900','10100')!;refreshed.resolve(response(snapshotFor(refreshed.url,clock,3,4)));clock+=160;await waitFor(()=>events.some(event=>event.columns[0]?.state==='live'&&event.columns[0]?.cursor===3));
    service.dispose();
  });

  it('clears a populated book on epoch change and waits in syncing until the new seed arrives',async()=>{
    const stream=headHarness(),api=deferredRequest(),events:Array<Extract<import('../src/feed/protocol').Event,{type:'depth-matrix-batch'}>>=[];let clock=10_000;
    const service=new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService,event=>events.push(event),api.request,()=>clock);
    service.command({type:'depth-matrix-subscribe',id:'one',settings:settings()});const notify=[...stream.observers.values()][0]!.callback;
    notify({type:'head',cursor:2,at:9_999,epoch:4});await waitFor(()=>api.calls.length===1);api.calls[0]!.resolve(response(snapshotFor(api.calls[0]!.url,9_999)));await waitFor(()=>events.some(event=>event.columns[0]?.state==='live'));
    clock+=160;notify({type:'head',cursor:3,at:clock,epoch:5});await waitFor(()=>pageCall(api,'9900','10100')!==undefined);await waitFor(()=>events.some(event=>event.columns[0]?.state==='syncing'));
    expect(events.at(-1)!.columns[0]!.rows).toEqual([]);const refreshed=pageCall(api,'9900','10100')!;refreshed.resolve(response(snapshotFor(refreshed.url,clock,3,5)));clock+=160;
    await waitFor(()=>events.some(event=>event.columns[0]?.state==='live'&&event.columns[0]?.epoch===5));service.dispose();
  });

  it('keeps Spot and Perp on the current page until both replacement markets are ready',async()=>{
    const stream=headHarness(),api=deferredRequest(),events:Array<Extract<import('../src/feed/protocol').Event,{type:'depth-matrix-batch'}>>=[];
    const configuration={...DEFAULT_DEPTH_MATRIX_SETTINGS,sources:['binance-spot','binance-perpetual','hyperliquid-perpetual']};
    let clock=10_000;const service=new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService,event=>events.push(event),api.request,()=>clock);
    service.command({type:'depth-matrix-subscribe',id:'one',settings:configuration});
    const spotHead=[...stream.observers.values()].find(observer=>observer.market==='spot')!.callback;
    const perpHead=[...stream.observers.values()].find(observer=>observer.market==='perpetual')!.callback;
    spotHead({type:'head',cursor:2,at:9_999,epoch:4});perpHead({type:'head',cursor:2,at:9_999,epoch:4});
    await waitFor(()=>api.calls.length===1);api.calls[0]!.resolve(response(snapshotFor(api.calls[0]!.url,9_999)));
    await waitFor(()=>pageCall(api,'9900','10100','perpetual')!==undefined);
    const initialPerp=pageCall(api,'9900','10100','perpetual')!;initialPerp.resolve(response(snapshotFor(initialPerp.url,9_999)));clock+=160;
    await waitFor(()=>events.some(event=>event.columns[0]?.state==='live'&&event.columns[1]?.state==='live'));
    expect(events.at(-1)!.columns[2]).toMatchObject({source:'hyperliquid-perpetual',state:'unavailable',rows:[]});

    await waitFor(()=>pageCall(api,'10000','10200','spot')!==undefined&&pageCall(api,'10000','10200','perpetual')!==undefined);
    const nextSpot=pageCall(api,'10000','10200','spot')!,nextPerp=pageCall(api,'10000','10200','perpetual')!;
    nextSpot.resolve(response(snapshotFor(nextSpot.url,clock,3,4)));await new Promise(resolve=>setTimeout(resolve,0));
    service.command({type:'depth-matrix-viewport',id:'one',viewport:{low:'10000',high:'10200'}});clock+=160;
    await waitFor(()=>events.at(-1)!.viewport?.low==='9900'&&events.at(-1)!.columns[0]?.cursor===2&&events.at(-1)!.columns[1]?.cursor===2);
    expect(events.at(-1)!.columns[0]!.rows).not.toEqual([]);expect(events.at(-1)!.columns[1]!.rows).not.toEqual([]);

    nextPerp.resolve(response(snapshotFor(nextPerp.url,clock,3,4)));clock+=160;
    await waitFor(()=>events.at(-1)!.viewport?.low==='10000'&&events.at(-1)!.columns[0]?.cursor===3&&events.at(-1)!.columns[1]?.cursor===3);
    expect(events.at(-1)!.columns[0]!.rows).not.toEqual([]);expect(events.at(-1)!.columns[1]!.rows).not.toEqual([]);service.dispose();
  });

  it('aborts pending viewport data when settings change and ignores its late response',async()=>{
    const stream=headHarness(),api=deferredRequest(),events:Array<Extract<import('../src/feed/protocol').Event,{type:'depth-matrix-batch'}>>=[];
    const service=new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService,event=>events.push(event),api.request,()=>10_000);
    service.command({type:'depth-matrix-subscribe',id:'one',settings:settings()});const notify=[...stream.observers.values()][0]!.callback;notify({type:'head',cursor:2,at:9_999,epoch:4});
    await waitFor(()=>api.calls.length===1);api.calls[0]!.resolve(response(snapshotFor(api.calls[0]!.url,9_999)));await waitFor(()=>api.calls.length===3&&events.length>0);
    service.command({type:'depth-matrix-viewport',id:'one',viewport:{low:'9600',high:'10000'}});await waitFor(()=>pageCall(api,'9600','10000')!==undefined);
    const abandoned=pageCall(api,'9600','10000')!;service.command({type:'depth-matrix-settings',id:'one',settings:{...settings(),bucketWidth:'200'}});
    expect(abandoned.signal?.aborted).toBe(true);await waitFor(()=>api.calls.some(call=>new URL(call.url,'http://unit.test').searchParams.get('width')==='200'));
    abandoned.resolve(response(snapshotFor(abandoned.url,9_999)));await new Promise(resolve=>setTimeout(resolve,30));
    expect(events.some(event=>event.viewport?.low==='9600')).toBe(false);
    const pending=api.calls.find(call=>new URL(call.url,'http://unit.test').searchParams.get('width')==='200')!;
    service.dispose();expect(pending.signal?.aborted).toBe(true);
  });

  it('bounds active and adjacent cached pages for eight independently panned widgets',async()=>{
    const stream=headHarness(),api=deferredRequest(),events:Array<Extract<import('../src/feed/protocol').Event,{type:'depth-matrix-batch'}>>=[];
    const service=new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService,event=>events.push(event),api.request,()=>10_000);
    const both={...DEFAULT_DEPTH_MATRIX_SETTINGS,sources:['binance-spot','binance-perpetual']};
    for(let i=0;i<8;i++)service.command({type:'depth-matrix-subscribe',id:`matrix-${i}`,settings:both});
    const spot=[...stream.observers.values()].find(observer=>observer.market==='spot')!.callback;
    const perp=[...stream.observers.values()].find(observer=>observer.market==='perpetual')!.callback;
    spot({type:'head',cursor:2,at:9_999,epoch:4});perp({type:'head',cursor:2,at:9_999,epoch:4});await waitFor(()=>api.calls.length===1);
    api.calls[0]!.resolve(response(snapshotFor(api.calls[0]!.url,9_999)));await waitFor(()=>api.calls.some(call=>new URL(call.url,'http://unit.test').searchParams.get('market')!=='spot'));
    const initialPerp=api.calls.findIndex(call=>new URL(call.url,'http://unit.test').searchParams.get('market')!=='spot');api.calls[initialPerp]!.resolve(response(snapshotFor(api.calls[initialPerp]!.url,9_999)));
    await waitFor(()=>events.length>0);
    for(let i=0;i<8;i++)service.command({type:'depth-matrix-viewport',id:`matrix-${i}`,viewport:{low:String(9_000+i*100),high:String(9_200+i*100)}});
    expect(service.diagnostics().activeWidgets).toBe(8);expect(service.diagnostics().activeGrids).toBeLessThanOrEqual(64);
    expect(service.diagnostics().activeGrids).toBeGreaterThan(16);service.dispose();
  });

  it('releases shared observers when the last widget closes and disposes safely',()=>{
    const stream=headHarness(),service=new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService,()=>{});
    service.command({type:'depth-matrix-subscribe',id:'one',settings:settings()});service.command({type:'depth-matrix-unsubscribe',id:'one'});
    expect(stream.observers.size).toBe(0);expect(stream.releases).toBe(1);expect(service.diagnostics()).toMatchObject({activeWidgets:0,activeMarkets:0});service.dispose();expect(stream.releases).toBe(1);
  });
});

it('recovers fresh HTTP snapshots when the depth stream is silent, then returns to stream heads', async () => {
  const stream = headHarness(); const started = Date.now(); let offset = 0, latest: any; const now = () => 10_000 + offset + Date.now() - started;
  const urls: string[] = [];
  const request: typeof fetch = async input => {
    const url = String(input); urls.push(url);
    if (url.includes('/health')) return response({ market: 'perpetual', depth: { status: { state: 'live' }, head: { cursor: 2, at: now(), epoch: 4 } } });
    return response(snapshotFor(url, now()));
  };
  const service = new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService, event => latest = event, request, now);
  try {
    service.command({ type: 'depth-matrix-subscribe', id: 'recovery', settings: settings() });
    expect(urls).toHaveLength(0);
    offset = 6_000;
    await waitFor(() => latest?.columns[0]?.rows.length > 0);
    expect(latest.columns[0].state).toBe('live');
    expect(latest.columns[0].message).toContain('HTTP snapshot recovery');
    expect(urls.filter(url => url.includes('/health'))).toHaveLength(1);
    stream.observers.get('depth-matrix:perpetual')!.callback({ type: 'head', cursor: 2, at: now(), epoch: 4 });
    offset += 200;
    await waitFor(() => !latest.columns[0].message.includes('HTTP snapshot recovery'));
    expect(latest.columns[0].state).toBe('live');
  } finally { service.dispose(); }
});

it('reports stale HTTP recovery without turning missing book data into live rows', async () => {
  const stream = headHarness(); const started = Date.now(); let offset = 0, latest: any; const now = () => 10_000 + offset + Date.now() - started;
  const service = new StagingDepthMatrixService(stream.heads as unknown as StagingHeatmapService, event => latest = event,
    async () => response({ market: 'perpetual', depth: { status: { state: 'live' }, head: { cursor: 2, at: 1, epoch: 4 } } }), now);
  try {
    service.command({ type: 'depth-matrix-subscribe', id: 'stale-recovery', settings: settings() });
    offset = 6_000;
    await waitFor(() => latest?.columns[0]?.state === 'stale');
    expect(latest.columns[0].rows).toHaveLength(0);
    expect(latest.columns[0].message).toContain('No fresh synchronized depth snapshot');
  } finally { service.dispose(); }
});

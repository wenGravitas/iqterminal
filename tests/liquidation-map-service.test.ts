import {test,expect,vi,afterEach} from 'vitest';
import {LiquidationMapService} from '../src/feed/liquidation-map-service';
import {mapSettings} from '../src/liquidation-map/model';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
const at=1800000000000;
const column=(time:number)=>({at:time,availableAt:time,revision:time,cells:[],quality:[]});
function setup(){vi.useFakeTimers();vi.setSystemTime(at+3600000);vi.stubEnv('VITE_DATA_MODE','staging');const service=new LiquidationMapService(()=>{});const requests:URL[]=[];vi.stubGlobal('fetch',vi.fn(async(input:string)=>{const url=new URL(input,'http://localhost');requests.push(url);const from=Number(url.searchParams.get('from')),to=Number(url.searchParams.get('to'));return new Response(JSON.stringify({version:1,semantics:'conditional-exposure',from,to,resolution:10000,priceWidth:100,columns:[column(from+1)],sources:[],head:10,next:null,asOf:Date.now()}));}));const client=(from:number,to:number)=>({from,to,settings:mapSettings({resolution:10000,lookback:60000}),pending:false,dirty:true});return{service,requests,client};}
test('overlapping navigation fetches only missing coverage and reuses warm visual-filter reads',async()=>{
 const {service,requests,client}=setup();try{
  await (service as any).read(client(at,at+60000));
  const overlap=await (service as any).read(client(at+20000,at+80000));expect(overlap.columns[0].availableAt).toBe(at+1);
  expect(requests).toHaveLength(2);
  expect(requests[1].searchParams.get('from')).toBe(String(at+60000));
  expect(requests[1].searchParams.get('to')).toBe(String(at+80000));
  await (service as any).read({...client(at+20000,at+80000),settings:mapSettings({resolution:10000,lookback:60000,opacity:.2})});
  expect(requests).toHaveLength(2);
 }finally{service.dispose();}
});
test('cursor reset discards obsolete cached history and reacquires a bounded snapshot',async()=>{
 const {service,client}=setup();try{
  await (service as any).read(client(at,at+60000));vi.setSystemTime(at+3611000);
  const fetcher=vi.mocked(fetch);fetcher.mockResolvedValueOnce(new Response('{}',{status:409}));
  const result=await (service as any).read(client(at,at+60000));
  expect(result.columns).toHaveLength(1);expect(result.generation).toBe(1);
  const url=new URL(String(fetcher.mock.calls.at(-1)![0]),'http://localhost');expect(url.searchParams.get('after')).toBe('0');expect(url.searchParams.has('head')).toBe(false);
 }finally{service.dispose();}
});
test('rapid viewport updates keep one pending request and its original grid metadata',async()=>{
 const {service,client}=setup();let resolve!:(r:Response)=>void;
 const fetcher=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));vi.stubGlobal('fetch',fetcher);
 service.subscribe('one',at,at+60000,client(at,at+60000).settings);
 const task=[...(service as any).flights.values()][0] as Promise<any>;
 for(let n=0;n<50;n++)service.subscribe('one',at+n*100,at+60000+n*100,mapSettings({resolution:10000,lookback:60000,priceWidth:250}));
 expect(fetcher).toHaveBeenCalledTimes(1);
 service.dispose();resolve(new Response(JSON.stringify({version:1,semantics:'conditional-exposure',from:at,to:at+60000,resolution:10000,priceWidth:100,columns:[],sources:[],head:1,next:null,asOf:Date.now()})));
 expect((await task).priceWidth).toBe(100);expect((service as any).cache.size).toBe(0);
});

test('dense real-shaped history switches to bounded as-of time LOD and reuses it on warm reopen',async()=>{
 const {service,client}=setup(),settings=mapSettings({resolution:60000,lookback:4*3600000});
 const cell={low:50000,high:50100,quantity:1,side:'long',venue:'bybit',kind:'estimated',scenario:'scenario-test',leverage:10,quote:'USDT',nativePrice:50050,modelVersion:'test',riskVersion:'test'};
 const cells=Array.from({length:6000},()=>cell),resolutions:number[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>{const u=new URL(input,'http://localhost'),resolution=Number(u.searchParams.get('resolution')),from=Number(u.searchParams.get('from')),to=Number(u.searchParams.get('to'));resolutions.push(resolution);
  const after=Number(u.searchParams.get('after')),dense=resolution<480000;
  const columns=Array.from({length:dense?2:1},(_,i)=>({...column(from+(i+(after?2:0))*resolution+1),cells}));
  return new Response(JSON.stringify({version:1,semantics:'conditional-exposure',from,to,resolution,priceWidth:100,columns,sources:[],head:10,next:dense&&after===0?5:null,asOf:Date.now()}));
 }));
 try{
  const request={...client(at-3*3600000,at+3600000),settings};
  const payload=await (service as any).read(request);
  expect(payload.resolution).toBeGreaterThanOrEqual(480000);
  expect(resolutions.length).toBeGreaterThan(1);
  expect(payload.columns).toHaveLength(1);expect(payload.columns[0].cells).toHaveLength(6000);
  expect(JSON.stringify(payload).length*2).toBeLessThanOrEqual(8*1024*1024);
  const before=resolutions.length;const warm=await (service as any).read({...request,settings:{...settings,opacity:.2}});
  expect(warm.resolution).toBe(payload.resolution);expect(resolutions).toHaveLength(before);
  expect((service as any).cacheBytes).toBeLessThanOrEqual(32*1024*1024);
 }finally{service.dispose();}
});

test('mandatory retirement boundaries use bounded local price LOD without restarting the transfer',async()=>{
 const {service,client}=setup(),settings=mapSettings({resolution:60000,lookback:4*3600000}),widths:number[]=[];
 const cell={low:50000,high:50100,quantity:1,side:'long',venue:'bybit',kind:'estimated',scenario:'test',leverage:10,quote:'USDT',nativePrice:50050,modelVersion:'v4',riskVersion:'test'};
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>{const u=new URL(input,'http://localhost'),width=Number(u.searchParams.get('priceWidth')),from=Number(u.searchParams.get('from')),to=Number(u.searchParams.get('to')),resolution=Number(u.searchParams.get('resolution')),after=Number(u.searchParams.get('after'));widths.push(width);
 const cells=Array.from({length:35000},(_,i)=>{const low=50000+Math.floor(i/36)*100;return{...cell,scenario:'s'+i%36,low,high:low+100,nativePrice:low+50+(after?.1:0)};});
 const columns=after?[{...column(from+200001),cells}]:[{...column(from+1),validUntil:from+50001,cells},{...column(from+50001),cells:[]},{...column(from+150001),cells:[]}];
 return new Response(JSON.stringify({version:1,historyVersion:2,semantics:'conditional-exposure',from,to,resolution,priceWidth:width,columns,sources:[],head:10,next:after?null:5,asOf:Date.now()}));
 }));
 try{const request={...client(at-3*3600000,at+3600000),settings},payload=await(service as any).read(request);expect(payload.priceWidth).toBe(200);expect(payload.columns).toHaveLength(4);expect(payload.columns[0].validUntil).toBe(payload.from+50001);expect(widths).toEqual([100,100]);expect(payload.columns[0].cells.reduce((n:number,c:any)=>n+c.quantity,0)).toBe(35000);expect(payload.columns[3].cells.reduce((n:number,c:any)=>n+c.quantity,0)).toBe(35000);
 const count=widths.length;const warm=await(service as any).read({...request,settings:{...settings,opacity:.2}});expect(warm.priceWidth).toBe(200);expect(widths).toHaveLength(count);expect((service as any).cacheBytes).toBeLessThanOrEqual(32*1024*1024);
 }finally{service.dispose();}
});


test('seven-day lookback stays inside the server range limit after tile alignment',async()=>{
 const {service,requests,client}=setup();
 try{
  const to=at+3599123,lookback=7*86400000;
  await(service as any).read({...client(to-lookback,to),settings:mapSettings({lookback})});
  expect(requests.length).toBeGreaterThan(0);
  expect(Number(requests[0].searchParams.get('from'))).toBeLessThanOrEqual(to-lookback);
  expect(Number(requests.at(-1)!.searchParams.get('to'))).toBeGreaterThanOrEqual(to);
  for(const url of requests){
   const from=Number(url.searchParams.get('from')),end=Number(url.searchParams.get('to')),resolution=Number(url.searchParams.get('resolution'));
   expect(end-from).toBeLessThanOrEqual(lookback);
   expect(from%resolution).toBe(0);expect(end%resolution).toBe(0);

  }
 }finally{service.dispose();}
});

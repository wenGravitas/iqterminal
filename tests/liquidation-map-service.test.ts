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

/** Explicit synthetic, deterministic Pi/host benchmark. No venue connections or source writes. */
import {OrderWallDetector,DEFAULT_ORDER_WALLS_SETTINGS,type OrderWallDepthRecord} from '../src/feed/order-walls';
import {DirectWallBookProjection} from '../src/feed/order-wall-book-projection';
import type {BinanceDepthBook} from '../src/feed/depth-book';
import {OrderWallRankIndex} from '../src/feed/order-wall-rank';
import {performance} from 'node:perf_hooks';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import os from 'node:os';
const count=Number(process.env.TOP_BENCH_EVENTS??3000),at=1800000000000;
const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]??0;
const bids=Array.from({length:5000},(_,i)=>[80000-i*.1,1+(i%73===0?500:0)+(i%13)/100] as const);
const asks=Array.from({length:5000},(_,i)=>[80000.1+i*.1,1+(i%79===0?700:0)+(i%11)/100] as const);
let seed=123;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
const records:OrderWallDepthRecord[]=[{kind:'snapshot',cursor:1,at,epoch:1,bids,asks,bookScope:{bidComplete:false,askComplete:false,bidFloor:79500,askCeiling:80500.1}}];
for(let i=1;i<=count;i++){const b:Array<readonly[number,number]>=[],a:Array<readonly[number,number]>=[];for(let j=0;j<20;j++){
 const k=Math.floor(random()*5000),q=Number((1+random()*500).toFixed(3));(j%2?a:b).push([j%2?asks[k]![0]:bids[k]![0],q]);}
 records.push({kind:'delta',cursor:i+1,at:at+i*100,epoch:1,bids:b,asks:a});}
const modes=['top-levels','threshold'] as const,results=[];
for(const mode of modes){global.gc?.();const heapBefore=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),start=performance.now();const d=new OrderWallDetector({...DEFAULT_ORDER_WALLS_SETTINGS,mode,enabled:true,aggregation:mode==='top-levels'?'native':50},.1,50);const durations:number[]=[];let bytes=0;
 const workload=mode==='threshold'?records.slice(0,301):records;
 for(const row of workload){const t=performance.now();const patches=d.processBatch([row]);durations.push(performance.now()-t);for(const p of patches)bytes+=(p.valuePoints?.length??0)*40+192;}
 results.push({mode,aggregation:mode==='top-levels'?'native':50,events:workload.length,levelsPerSide:5000,changesPerObservation:20,replayMs:performance.now()-start,eventMedianMs:percentile(durations,.5),eventP95Ms:percentile(durations,.95),eventMaxMs:Math.max(...durations),cpu:process.cpuUsage(cpu),heapDeltaBytes:process.memoryUsage().heapUsed-heapBefore,patchBytesEstimate:bytes,diagnostics:d.diagnostics()});console.error('Completed detector scenario',mode,workload.length);
}
// Matched ranking workload: same 5000-price book, updates, range, N and tie rule.
const index=new OrderWallRankIndex(),map=new Map<number,number>();for(const [p,q]of bids){index.set(p,p*q);map.set(p,p*q);}
const indexed:number[]=[],fullSort:number[]=[];let mismatches=0;
for(let i=1;i<Math.min(records.length,1001);i++){
 for(const[p,q]of records[i]!.bids!){map.set(p,p*q);index.set(p,p*q);}
 let t=performance.now();const a=index.top(8,79500,80000);indexed.push(performance.now()-t);
 t=performance.now();const b=[...map].map(([price,usd])=>({price,usd})).filter(x=>x.price>=79500&&x.price<=80000).sort((a,b)=>b.usd-a.usd||a.price-b.price).slice(0,8);fullSort.push(performance.now()-t);
 if(JSON.stringify(a)!==JSON.stringify(b))mismatches++;
}
const direct=new DirectWallBookProjection(),directBids=new Map(bids),directAsks=new Map(asks),projectionMs:number[]=[];
const directBook={lastUpdateId:1,snapshotBidBoundary:79500,snapshotAskBoundary:80500.1,visitLevels(callback:(side:'bid'|'ask',p:number,q:number)=>void){for(const[p,q]of directBids)callback('bid',p,q);for(const[p,q]of directAsks)callback('ask',p,q);}} as unknown as BinanceDepthBook;
for(let i=1;i<Math.min(records.length,301);i++){
 for(const[p,q]of records[i]!.bids!)directBids.set(p,q);for(const[p,q]of records[i]!.asks!)directAsks.set(p,q);(directBook as any).lastUpdateId=i+1;
 const t=performance.now();for(let consumer=0;consumer<8;consumer++)direct.project(directBook,1);projectionMs.push(performance.now()-t);
}
const directProjection={kind:'synthetic-shared-USD-M-full-book-adapter',events:projectionMs.length,consumers:8,p95Ms:percentile(projectionMs,.95),medianMs:percentile(projectionMs,.5),maxMs:Math.max(...projectionMs),metrics:direct.diagnostics()};
const output={kind:'explicit-synthetic-depth-not-real-venue-performance',directProjection,hardware:{model:(()=>{try{return readFileSync('/proc/device-tree/model','utf8').replaceAll('\0','');}catch{return os.arch();}})(),arch:os.arch(),node:process.version,load:os.loadavg(),rss:process.memoryUsage().rss},results,ranking:{mismatches,queries:indexed.length,indexedP95Ms:percentile(indexed,.95),fullSortP95Ms:percentile(fullSort,.95),metrics:index.metrics}};
mkdirSync('artifacts/order-walls',{recursive:true});writeFileSync('artifacts/order-walls/top-levels-detector-bench.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));

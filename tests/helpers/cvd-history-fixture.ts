import {vi} from 'vitest';
import {CvdHistoryOwner} from '../../src/feed/cvd-history-owner';
import {HistoryScheduler} from '../../src/feed/history-scheduler';
import {recordedMinuteWire} from './recorded-minute-wire';
import type {MinuteHistoryRequest} from '../../src/feed/recorded-minute-history';
export const MINUTE=60000,HOUR=3600000,DAY=86400000,DAY_START=Date.UTC(2026,10,1),CVD_SOURCE='binance:perpetual' as const;
/** Consistent sparse input independent of page boundaries; explicit tests only. */
export function cvdHistoryFixture(cut=DAY_START+DAY,clock?:()=>number){
 let lease:any;const calls:Array<{url:string;init:RequestInit}>=[];let offline=false;
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
 const fetch=vi.fn(async(input:RequestInfo|URL,init:RequestInit={})=>{
  const url=new URL(String(input),'http://fixture');calls.push({url:String(input),init});const from=Number(url.searchParams.get('from')),to=Number(url.searchParams.get('to'));
  const rows=[];for(let t=Math.ceil(from/HOUR)*HOUR;t<to;t+=HOUR)rows.push({time:t,base:'1.00000001',quote:'10.0000001',firstId:String(t/HOUR),lastId:String(t/HOUR),records:'1'});
  if(url.pathname.endsWith('/cvd'))return json({version:2,semantics:'native-recorded-execution-minute-observations',source:CVD_SOURCE+':BTCUSDT',incarnation:'12345678-1234-4abc-8abc-123456789abc',revision:1,revisionScope:'incarnation',replacement:'requested-range',fullProjectionAt:cut+DAY+MINUTE,snapshot:true,stepMs:MINUTE,from,to,retainedFrom:cut,watermark:'10000000',watermarkKind:'aggregate-execution-id',baseUnit:'BTC',quoteUnit:'USDT',buckets:rows,coverage:{from,to,gaps:[]},status:'live',asOf:cut+DAY+MINUTE,sparse:true,cumulative:false,financialAccepted:false,currentReconciled:false,retirementAuthorized:false});
  if(init.method==='DELETE')return json({version:1,released:true});
  const request:MinuteHistoryRequest={dataset:'cvd',venue:'binance',market:'perpetual',from,to};
  if(init.method==='POST'){const p=recordedMinuteWire({...request,to:from+MINUTE}).publicationSnapshot;lease={kind:'iq-recorded-minute-observation-lease-v1',id:'12345678-1234-4abc-8abc-123456789abc',checkpoint:p.checkpoint,generation:p.generation,catalogueHead:p.catalogueHead,witness:'f'.repeat(64),source:p.frontier.source,acquiredAtMs:1800000000000,expiresAtMs:1800000060000,scope:request,witnessedAtAcquisition:true,currentReconciled:false,financialAccepted:false,recoveryQualified:false,retirementAuthorized:false};return json({version:1,token:'e'.repeat(64),lease});}
  if(offline)return json({},503);
  const p=recordedMinuteWire(request),sample=p.bars[0];p.bars=rows.map(({time,...r})=>({...sample,...r,timeMs:time,open:'10',high:'10',low:'10',close:'10',baseVolume:r.base,quoteVolume:r.quote}));return json({...p,observationLease:lease});
 });
 const owner=new CvdHistoryOwner(true,fetch,new HistoryScheduler(1),clock);
 return {owner,fetch,calls,cut,offline:(v=true)=>offline=v,seed:()=>owner.read({source:CVD_SOURCE,kind:'native',from:cut,to:cut+MINUTE},new AbortController().signal)};
}

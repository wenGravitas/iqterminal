import {historyScheduler} from './history-scheduler';
import {historyHttpError} from './history-http-error';
export interface WallHistoryHorizon {version:1;kind:'wall-source-horizon-v1';market:'spot'|'perpetual';profile:string;head:{cursor:number;epoch:number;at:number};availableFrom:number|null}
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
/** This metadata bounds eligibility only. Normal prepared/canonical source
 * validation still proves retained coverage, gaps and every financial record. */
export async function readWallHistoryHorizon(request:{market:'spot'|'perpetual';profile:string},fetcher:typeof fetch,signal:AbortSignal):Promise<WallHistoryHorizon|undefined>{
 const url='/market-data/v2/history/walls/horizon?'+new URLSearchParams(request);
 return historyScheduler.read(url,'order-walls',signal,async upstream=>{
  const response=await fetcher(url,{signal:upstream});
  if(response.status===404){await response.body?.cancel();return undefined;}
  if(!response.ok)throw await historyHttpError(response,upstream,'Wall history horizon');
  const reader=response.body?.getReader();let text='',bytes=0;const decoder=new TextDecoder();
  if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8192){await reader.cancel();throw Error('Wall history horizon byte capacity');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  else {const body=new Uint8Array(await response.arrayBuffer());if(body.byteLength>8192)throw Error('Wall history horizon byte capacity');text=decoder.decode(body);}
  upstream.throwIfAborted();const data=JSON.parse(text);
  if(data?.version!==1||data.kind!=='wall-source-horizon-v1'||data.market!==request.market||data.profile!==request.profile||!data.head||![data.head.cursor,data.head.epoch,data.head.at].every(integer)||data.availableFrom!==null&&!integer(data.availableFrom))throw Error('Invalid wall history horizon identity');
  return data;
 });
}
export function eligibleWallHistoryRange(request:{from:number;to:number},horizon:WallHistoryHorizon){
 if(![request.from,request.to].every(integer)||request.from>=request.to||!integer(horizon.head.at)||horizon.head.at===Number.MAX_SAFE_INTEGER)throw Error('Invalid wall history eligibility range');
 const to=Math.max(request.from,Math.min(request.to,horizon.head.at+1));
 return {from:request.from,to,requestedTo:request.to,horizonAt:horizon.head.at};
}

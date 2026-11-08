export interface HistoryRequestTrace {
 id:string;url:string;eligibleAt:number;wireAt:number;headersAt?:number;receivedAt?:number;decodedAt?:number;
 queueMs:number;headerMs?:number;transferMs?:number;decodeMs?:number;encodedBytes?:number;decodedBytes?:number;
 jobs?:Array<{id:string;lastQueryId?:string;queuePosition?:number|null;pages?:number;records?:number;category?:string;retryable?:boolean}>;
 receivedBars?:number;receivedFrom?:number;receivedLast?:number;
 requestId?:string;serverTiming?:string;dbQueries?:number;dbReadRows?:number;dbReadBytes?:number;slots?:number;state?:string;error?:string;
}
const sessionId=crypto.randomUUID();
let sequence=0;
const traces:HistoryRequestTrace[]=[];
export const historyViewId=()=>`view-${sessionId}-${++sequence}`;
export function historyRequestTraces(){return traces.map(trace=>({...trace}));}
/** All phase durations use this worker's monotonic clock. Server durations are separate. */
export async function tracedHistoryJson(request:typeof fetch,url:string,signal:AbortSignal,id:string,eligibleAt:number,options:{maxDecodedBytes?:number}={}){
 const wireAt=performance.now(),trace:HistoryRequestTrace={id,url,eligibleAt,wireAt,queueMs:wireAt-eligibleAt};
 traces.push(trace);if(traces.length>256)traces.shift();
 try{
  const response=await request(url,{signal,headers:{'X-IQ-View-Id':id}});
  trace.headersAt=performance.now();trace.headerMs=trace.headersAt-wireAt;
  trace.requestId=response.headers.get('x-iq-request-id')??undefined;trace.serverTiming=response.headers.get('server-timing')??undefined;
  const encoded=response.headers.get('content-length');if(encoded!==null)trace.encodedBytes=Number(encoded);
  for(const [key,header] of [['dbQueries','x-iq-db-queries'],['dbReadRows','x-iq-db-read-rows'],['dbReadBytes','x-iq-db-read-bytes']] as const){const value=response.headers.get(header);if(value!==null)trace[key]=Number(value);}
  let text:string;
  if(options.maxDecodedBytes!==undefined){
   const reader=response.body?.getReader(),parts:Uint8Array[]=[];let size=0;
   if(reader)try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>options.maxDecodedBytes){await reader.cancel();throw Error('History response decoded byte capacity');}parts.push(value);}}finally{reader.releaseLock();}
   const raw=new Uint8Array(size);let at=0;for(const part of parts){raw.set(part,at);at+=part.byteLength;}text=new TextDecoder().decode(raw);
  }else text=await response.text();trace.receivedAt=performance.now();trace.transferMs=trace.receivedAt-trace.headersAt;
  trace.decodedBytes=new TextEncoder().encode(text).byteLength;
  let result:any;try{result=JSON.parse(text);}catch{throw Error(response.ok?'History returned invalid JSON':`History HTTP ${response.status}`);}trace.decodedAt=performance.now();trace.decodeMs=trace.decodedAt-trace.receivedAt;
  trace.slots=result.tiles?.length;trace.state=result.state;
  if(result.source==='binance-native-kline'&&Array.isArray(result.candles)){trace.receivedBars=result.candles.length;trace.receivedFrom=result.candles[0]?.t;trace.receivedLast=result.candles.at(-1)?.t;}
  if(Array.isArray(result.jobs))trace.jobs=result.jobs.slice(0,32).map((job:any)=>({id:job.id,lastQueryId:job.lastQueryId,queuePosition:job.queuePosition,pages:job.pages,records:job.records,category:job.category,retryable:job.retryable}));
  if(!response.ok)throw Error(result.error??`History HTTP ${response.status}`);
  return result;
 }catch(error){trace.error=error instanceof Error?error.message:String(error);throw error;}
}

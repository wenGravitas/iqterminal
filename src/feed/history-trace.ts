export interface HistoryRequestTrace {
 id:string;url:string;eligibleAt:number;wireAt:number;headersAt?:number;receivedAt?:number;decodedAt?:number;
 queueMs:number;headerMs?:number;transferMs?:number;decodeMs?:number;encodedBytes?:number;decodedBytes?:number;
 requestId?:string;serverTiming?:string;dbQueries?:number;dbReadRows?:number;dbReadBytes?:number;slots?:number;state?:string;error?:string;
}
let sequence=0;
const traces:HistoryRequestTrace[]=[];
export const historyViewId=()=>`view-${++sequence}`;
export function historyRequestTraces(){return traces.map(trace=>({...trace}));}
/** All phase durations use this worker's monotonic clock. Server durations are separate. */
export async function tracedHistoryJson(request:typeof fetch,url:string,signal:AbortSignal,id:string,eligibleAt:number){
 const wireAt=performance.now(),trace:HistoryRequestTrace={id,url,eligibleAt,wireAt,queueMs:wireAt-eligibleAt};
 traces.push(trace);if(traces.length>256)traces.shift();
 try{
  const response=await request(url,{signal,headers:{'X-IQ-View-Id':id}});
  trace.headersAt=performance.now();trace.headerMs=trace.headersAt-wireAt;
  trace.requestId=response.headers.get('x-iq-request-id')??undefined;trace.serverTiming=response.headers.get('server-timing')??undefined;
  const encoded=response.headers.get('content-length');if(encoded!==null)trace.encodedBytes=Number(encoded);
  for(const [key,header] of [['dbQueries','x-iq-db-queries'],['dbReadRows','x-iq-db-read-rows'],['dbReadBytes','x-iq-db-read-bytes']] as const){const value=response.headers.get(header);if(value!==null)trace[key]=Number(value);}
  const text=await response.text();trace.receivedAt=performance.now();trace.transferMs=trace.receivedAt-trace.headersAt;
  trace.decodedBytes=new TextEncoder().encode(text).byteLength;
  const result=JSON.parse(text);trace.decodedAt=performance.now();trace.decodeMs=trace.decodedAt-trace.receivedAt;
  trace.slots=result.tiles?.length;trace.state=result.state;
  if(!response.ok)throw Error(result.error??`History HTTP ${response.status}`);
  return result;
 }catch(error){trace.error=error instanceof Error?error.message:String(error);throw error;}
}

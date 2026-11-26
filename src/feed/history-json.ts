/** Bounded decoded-body transport shared by optional historical readers. */
export const HISTORY_JSON_MAX_BYTES=4*1024**2;
export class HistoryResponseFailure extends Error {
 constructor(readonly reason:'network'|'invalid'|'disabled',readonly retryable:boolean){super('Historical response unavailable');}
}
export async function readHistoryJson<T>(response:Response,signal:AbortSignal,maxBytes:number,validate:(value:unknown)=>T){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>HISTORY_JSON_MAX_BYTES){await response.body?.cancel();throw new HistoryResponseFailure('invalid',false);}
 if(!response.ok){await response.body?.cancel();throw new HistoryResponseFailure(response.status===404?'disabled':'network',[429,500,502,503,504].includes(response.status));}
 if(Number(response.headers.get('content-length')??0)>maxBytes){await response.body?.cancel();throw new HistoryResponseFailure('invalid',false);}
 if(!response.body)throw new HistoryResponseFailure('invalid',false);
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,done=false;
 let cancelling:Promise<void>|undefined;const cancel=()=>cancelling??=reader.cancel().catch(()=>{}),abort=()=>{void cancel();};
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 try{
  for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){done=true;break;}size+=part.value.byteLength;if(size>maxBytes)throw new HistoryResponseFailure('invalid',false);chunks.push(part.value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  try{return {payload:validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))),bytes:size};}catch{throw new HistoryResponseFailure('invalid',false);}
 }finally{signal.removeEventListener('abort',abort);try{if(cancelling)await cancelling;else if(!done)await cancel();}finally{reader.releaseLock();}}
}

/** Bounded receive-ahead for one admitted wall batch. Network receipt continues
 * while individual members decode/yield; no extra fetch or decoder is admitted.
 * Earlier members can validate before EOF, but terminal publication requires it.
 */
export function receiveWallBatch(body:ReadableStream<Uint8Array>,bytes:number,signal:AbortSignal){
 if(!Number.isSafeInteger(bytes)||bytes<1||bytes>8*1024*1024)throw Error('Prepared wall batch byte capacity');
 const buffer=new Uint8Array(bytes),reader=body.getReader();
 let received=0,offset=0,ended=false,failure:unknown,wake:(()=>void)|undefined;
 const notify=()=>{wake?.();wake=undefined;};
 const cancel=()=>{void reader.cancel(signal.reason).catch(()=>{});};
 signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
 const pump=(async()=>{
  try{
   while(true){
    signal.throwIfAborted();const item=await reader.read();if(item.done)break;
    if(received+item.value.byteLength>bytes)throw Error('Prepared wall batch byte identity mismatch');
    buffer.set(item.value,received);received+=item.value.byteLength;notify();
   }
   if(received!==bytes)throw Error('Prepared wall batch byte identity mismatch');
  }catch(error){failure=error;await reader.cancel(error).catch(()=>{});}
  finally{ended=true;reader.releaseLock();notify();}
 })();
 return {
  async exact(length:number){
   if(!Number.isSafeInteger(length)||length<0||offset+length>bytes)throw Error('Prepared wall batch byte identity mismatch');
   const end=offset+length;
   while(received<end&&!ended){signal.throwIfAborted();await new Promise<void>(resolve=>{wake=resolve;});}
   signal.throwIfAborted();
   if(received<end)throw failure??Error('Prepared wall batch byte identity mismatch');
   const result=buffer.subarray(offset,end);offset=end;return result;
  },
  async finish(){await pump;signal.throwIfAborted();if(failure)throw failure;if(offset!==bytes)throw Error('Prepared wall batch byte identity mismatch');},
  async close(){signal.removeEventListener('abort',cancel);if(!ended)await reader.cancel().catch(()=>{});await pump;},
 };
}

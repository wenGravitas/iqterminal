/** A failed history response must not discard its useful server reason, or
 * hold an admission slot indefinitely while an error body stalls. */
export async function historyHttpError(response:Response,signal:AbortSignal,label:string):Promise<Error>{
 signal.throwIfAborted();
 const fallback=label+' HTTP '+response.status,reader=response.body?.getReader();
 if(!reader)return Error(fallback);
 let timer:ReturnType<typeof setTimeout>|undefined,stop:()=>void=()=>{};
 const interrupted=new Promise<undefined>(resolve=>{
  stop=()=>resolve(undefined);signal.addEventListener('abort',stop,{once:true});timer=setTimeout(stop,1000);
 });
 const detail=(async()=>{
  try{
   const chunks:Uint8Array[]=[];let bytes=0;
   for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>4096)return;chunks.push(item.value);}
   const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
   const value:unknown=JSON.parse(new TextDecoder().decode(body));
   if(!value||typeof value!=='object'||!('error'in value)||typeof value.error!=='string')return;
   return value.error.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,240)||undefined;
  }catch{return;}
 })();
 let reason:string|undefined;
 try{reason=await Promise.race([detail,interrupted]);}
 finally{
  clearTimeout(timer);signal.removeEventListener('abort',stop);
  // Cancellation is consumer-specific and cleanup cannot extend the deadline.
  void reader.cancel().catch(()=>{});reader.releaseLock();
 }
 signal.throwIfAborted();
 return Error(reason?fallback+': '+reason:fallback);
}

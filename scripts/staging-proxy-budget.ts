import type {IncomingMessage,ServerResponse} from 'node:http';
import {performance} from 'node:perf_hooks';
import {markProxyAdmission} from './staging-proxy-observability.ts';
type Lane='native'|'bulk';
interface Waiting {lane:Lane;response:ServerResponse;next:()=>void;finish:()=>void;active:boolean;done:boolean}
/** Transport admission only. Current/stream routes bypass it. Shared three-slot
 * cap matches the gateway while both existing two-socket agents remain usable. */
export class StagingHistoryBudget {
 private pending:Waiting[]=[];private active=new Set<Waiting>();private draining=false;private closed=false;
 private count={native:0,bulk:0};
 constructor(private classify:(request:IncomingMessage)=>Lane|undefined){}
 middleware=(request:IncomingMessage,response:ServerResponse,next:()=>void)=>{
  const lane=this.classify(request);if(!lane){next();return;}
  if(this.closed||this.pending.length>=128){response.writeHead(503,{'Retry-After':'1','Content-Type':'application/json'});response.end('{"error":"Local historical request capacity; retry"}');return;}
  markProxyAdmission(request,performance.now());
  const item:Waiting={lane,response,next,active:false,done:false,finish:()=>{
   if(item.done)return;item.done=true;response.off('close',item.finish);response.off('finish',item.finish);
   if(item.active){this.active.delete(item);this.count[lane]--;}else{const index=this.pending.indexOf(item);if(index>=0)this.pending.splice(index,1);}
   this.drain();
  }};
  response.once('close',item.finish);response.once('finish',item.finish);this.pending.push(item);this.drain();
 };
 private drain(){
  if(this.draining||this.closed)return;this.draining=true;
  try{while(this.active.size<3){
   // At least one lane remains available to native reads when bulk is busy.
   let index=this.count.native<2?this.pending.findIndex(item=>item.lane==='native'):-1;
   if(index<0&&this.count.bulk<2)index=this.pending.findIndex(item=>item.lane==='bulk');
   if(index<0)break;const item=this.pending.splice(index,1)[0]!;
   if(item.response.destroyed){item.finish();continue;}
   item.active=true;this.active.add(item);this.count[item.lane]++;
   try{item.next();}catch(error){item.response.destroy(error instanceof Error?error:Error(String(error)));item.finish();}
  }}finally{this.draining=false;}
 }
 close(){this.closed=true;for(const item of [...this.pending,...this.active]){item.response.destroy();item.finish();}this.pending=[];}
}

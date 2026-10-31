import { historyScheduler } from './history-scheduler';
import { CVD_STEP,CVD_SOURCES,CVD_MAX_POINTS,CvdCalculation,validateCvdPayload,compatibleCvdSources,type CvdBucket,type CvdPayload,type CvdRequest,type CvdSource,type CvdSeries,type CvdEvent } from './cvd';
import type { ExecutionFeed } from './bybit-service';
interface Source {payload?:CvdPayload;rows:Map<number,CvdBucket>;revision:number;abort?:AbortController;busy:boolean;next:number;release?:()=>void;recent:Set<string>}
interface Client {id:string;request:CvdRequest;generation:number;calculations:Map<CvdSource,CvdCalculation>;pending:Map<CvdSource,CvdSeries>;inFlight?:number}
function historyFailureMessage(error:unknown){
  const message=error instanceof Error?error.message:String(error);
  return /unexpected end of json input/i.test(message)?'Incomplete JSON response':message;
}
export class CvdService {
  private sources=new Map<CvdSource,Source>();private clients=new Map<string,Client>();
  private timer?:ReturnType<typeof setInterval>;private generation=0;private batch=0;private online=true;
  private fixture=false;
  constructor(private feeds:Partial<Record<'spot'|'perpetual'|CvdSource,ExecutionFeed>>,private emit:(e:CvdEvent)=>void,
    private recorded:boolean,private request:typeof fetch=(...args)=>fetch(...args),private now=Date.now){}
  setFixture(value:boolean){this.fixture=value;}
  subscribe(id:string,request:CvdRequest) {
    this.unsubscribe(id);if(this.clients.size>=8)return;
    const client:Client={id,request:{...request,sources:compatibleCvdSources(request.sources)},generation:++this.generation,calculations:new Map(),pending:new Map()};
    this.clients.set(id,client);
    for(const source of client.request.sources){
      client.calculations.set(source,new CvdCalculation(request));
      let state=this.sources.get(source);
      if(!state){state={rows:new Map(),revision:0,busy:false,next:0,recent:new Set()};this.sources.set(source,state);
        if(this.fixture)this.fixtureSource(source,state);
        else if(!this.recorded)this.directSource(source,state);
      }
      if(state.payload)this.deliver(client,source,{...state.payload,snapshot:true,buckets:[...state.rows.values()]});
    }
    this.start();this.flush();
  }
  unsubscribe(id:string){this.clients.delete(id);for(const [source,state]of this.sources)if(![...this.clients.values()].some(c=>c.request.sources.includes(source))){state.abort?.abort();state.release?.();this.sources.delete(source);}if(!this.clients.size&&this.timer){clearInterval(this.timer);this.timer=undefined;}}
  ack(id:string,generation:number,batch:number){const c=this.clients.get(id);if(c?.generation===generation&&c.inFlight===batch){c.inFlight=undefined;this.flush();}}
  setOnline(value:boolean){this.online=value;for(const [source,s]of this.sources)if(!value){s.abort?.abort();if(s.payload)this.ingest(source,{...s.payload,snapshot:false,buckets:[],status:'stale',message:'Network offline; known contributions retained',asOf:this.now()});}else s.next=0;}
  private start(){if(!this.timer)this.timer=setInterval(()=>this.tick(),250);this.tick();}
  private tick(){for(const [source,state]of this.sources)if(this.recorded&&!this.fixture&&this.online&&!state.busy&&this.now()>=state.next)void this.poll(source,state);this.flush();}
  private async poll(source:CvdSource,state:Source){
    state.busy=true;const abort=new AbortController();state.abort=abort;
    const since=state.payload?.revision??0;
    const url=`/market-data/v1/cvd?market=${source.endsWith(':spot')?'spot':'perpetual'}${source.startsWith('bybit:')?'&venue=bybit':''}&since=${since}`;
    try{
      const value=await historyScheduler.read(url,'cvd',abort.signal,async signal=>{
        const timeoutMs=since===0?60_000:25_000;
        const response=await this.request(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)])});
        const text=await response.text();let data:any;
        if(!response.ok){
          try{data=JSON.parse(text);}catch{}
          const detail=typeof data?.error==='string'?data.error:text.trim().replace(/\s+/g,' ').slice(0,180);
          throw Error(`Execution history HTTP ${response.status}${detail?`: ${detail}`:''}`);
        }
        try{data=JSON.parse(text);}catch(error){throw Error(historyFailureMessage(error));}
        return validateCvdPayload(data,source);
      });
      if(this.sources.get(source)!==state||abort.signal.aborted)return;
      this.ingest(source,value);state.next=this.now()+1000;
    }catch(error){
      if(this.sources.get(source)!==state||abort.signal.aborted)return;
      const payload=state.payload??this.empty(source);
      const status=state.rows.size?'stale':'unavailable',message=`Signed history unavailable: ${historyFailureMessage(error)}`;
      // Failed polls do not represent a new data update. Keep the last observed
      // timestamp, and avoid re-emitting an unchanged failure every retry.
      if(payload.status!==status||payload.message!==message)this.ingest(source,{...payload,snapshot:false,buckets:[],status,message});
      state.next=this.now()+5000;
    }finally{state.busy=false;if(state.abort===abort)state.abort=undefined;}
  }
  private empty(source:CvdSource):CvdPayload{
    const now=this.now(),from=Math.floor((now-7*86400000)/CVD_STEP)*CVD_STEP;
    return {version:1,source:`${source}:BTCUSDT`,stepMs:CVD_STEP,from,to:Math.ceil(now/CVD_STEP)*CVD_STEP,revision:0,snapshot:true,watermark:0,baseUnit:'BTC',quoteUnit:'USDT',buckets:[],coverage:{from:now,to:now,gaps:[]},status:'awaiting',asOf:0};
  }
  ingest(source:CvdSource,payload:CvdPayload){
    const state=this.sources.get(source);if(!state)return;
    if(state.payload&&payload.revision<state.payload.revision&&!payload.snapshot)return;
    if(payload.snapshot)state.rows.clear();
    for(const b of payload.buckets){const old=state.rows.get(b.time);if(!old||b.revision>=old.revision)state.rows.set(b.time,b);}
    for(const time of state.rows.keys())if(time<payload.from)state.rows.delete(time);
    if(state.rows.size>CVD_MAX_POINTS)throw Error('CVD source capacity exceeded');
    state.payload={...payload,buckets:[]};
    for(const client of this.clients.values())if(client.calculations.has(source))this.deliver(client,source,payload);
    this.flush();
  }
  private deliver(client:Client,source:CvdSource,payload:CvdPayload){
    const calc=client.calculations.get(source)!;
    const points=calc.apply(payload),previous=client.pending.get(source);
    const snapshot=payload.snapshot||!!previous; // coalescing behind ACK preserves the complete bounded state
    client.pending.set(source,{source,points:snapshot?calc.snapshot():points,snapshot,removeBefore:payload.from+CVD_STEP,coverage:payload.coverage,
      status:payload.status,message:payload.message??'',asOf:payload.asOf});
  }
  private flush(){
    for(const c of this.clients.values())if(!c.inFlight&&c.pending.size){
      const batchId=++this.batch,series=[...c.pending.values()];c.pending.clear();c.inFlight=batchId;
      this.emit({type:'cvd-batch',ids:[c.id],generation:c.generation,batchId,series});
    }
  }
  private fixtureSource(source:CvdSource,state:Source){
    const payload=this.empty(source),factor=source.endsWith(':spot')?1:2,values=[100,-40,20];
    payload.asOf=this.now();
    payload.status='live';payload.message='Fixture: synthetic signed execution history';payload.revision=1;payload.coverage={from:payload.from,to:this.now(),gaps:[]};
    for(let time=payload.from;time<payload.to;time+=CVD_STEP){const phase=Math.floor(time/CVD_STEP)%3,base=values[phase]!*factor;state.rows.set(time,{time,base,quote:base*(phase===1?88000:81000),revision:1});}
    state.payload={...payload,buckets:[]};
  }
  private directSource(source:CvdSource,state:Source){
    const payload=this.empty(source);payload.message='Observed live executions only; recorder history requires staging';state.payload=payload;
    const feed=this.feeds[source]??(source.startsWith('binance:')?this.feeds[source.endsWith(':spot')?'spot':'perpetual']:undefined);
    if(!feed){payload.status='unavailable';return;}
    let previousState='loading',lastAt=0;
    state.release=feed.subscribeExecutions(`cvd:${source}`,(trades,status,liveSince)=>{
      if(this.sources.get(source)!==state)return;
      const now=this.now(),current=state.payload??payload;
      const coverage={...current.coverage,gaps:[...current.coverage.gaps]};
      if(previousState==='live'&&status.state!=='live')coverage.gaps.push({from:lastAt||now,to:now+1,reason:'Execution connection interrupted'});
      if(previousState!=='live'&&status.state==='live'&&lastAt&&now>lastAt)coverage.gaps.push({from:lastAt,to:now,reason:'Unrepaired direct execution gap'});
      previousState=status.state;
      coverage.from=Math.min(coverage.from,liveSince||now);
      const changed=new Map<number,CvdBucket>();
      const revision=++state.revision;
      for(const trade of trades){
        if(trade.side==='unknown'){coverage.gaps.push({from:Math.floor(trade.timeMs/CVD_STEP)*CVD_STEP,to:Math.floor(trade.timeMs/CVD_STEP)*CVD_STEP+CVD_STEP,reason:'Unknown aggressor excluded'});continue;}
        if(state.recent.has(trade.executionId))continue;
        state.recent.add(trade.executionId);if(state.recent.size>8192)state.recent.delete(state.recent.values().next().value!);
        const time=Math.floor(trade.timeMs/CVD_STEP)*CVD_STEP,sign=trade.side==='buy'?1:-1;
        const bucket=changed.get(time)??{...(state.rows.get(time)??{time,base:0,quote:0,revision})};
        bucket.base+=sign*trade.quantity;bucket.quote+=sign*Number(trade.quoteNotionalText??trade.price*trade.quantity);bucket.revision=revision;changed.set(time,bucket);
        lastAt=Math.max(lastAt,trade.timeMs);coverage.to=Math.max(coverage.to===payload.asOf?0:coverage.to,lastAt);
      }
      coverage.gaps=coverage.gaps.slice(-512);
      const from=Math.floor((now-7*86400000)/CVD_STEP)*CVD_STEP;
      this.ingest(source,{...current,from,to:Math.ceil((now+1)/CVD_STEP)*CVD_STEP,coverage,revision,buckets:[...changed.values()],snapshot:false,
        status:status.state==='live'?'live':state.rows.size?'stale':'awaiting',asOf:now,message:'Observed live executions only; no recorder history/backfill'});
    });
  }
  diagnostics(){return {clients:this.clients.size,sources:[...this.sources].map(([source,s])=>({source,buckets:s.rows.size,revision:s.payload?.revision,status:s.payload?.status})),fixture:this.fixture};}
  dispose(){for(const id of [...this.clients.keys()])this.unsubscribe(id);}
}

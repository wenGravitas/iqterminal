import { parseBybitTrades } from './bybit';
import type { NormalizedExecution } from './footprint';
import type { Status } from './protocol';
export type ExecutionConsumer = (trades: readonly NormalizedExecution[], status: Status, liveSince: number) => void;
export interface ExecutionFeed { subscribeExecutions(id: string, consumer: ExecutionConsumer): () => void }
export interface BybitTransport { socket(url:string):WebSocket; now():number }
/** One demand-owned linear public socket shared by the ticker and direct CVD. */
export class BybitExecutionService implements ExecutionFeed {
  private consumers=new Map<string,ExecutionConsumer>();private ws?:WebSocket;
  private timer?:ReturnType<typeof setInterval>;private retryTimer?:ReturnType<typeof setTimeout>;
  private recent=new Map<string,string>();private status:Status={state:'loading',message:'Waiting for Bybit prints',lastUpdate:0};
  private liveSince=0;private attempt=0;private online=true;private dead=false;private openedAt=0;
  constructor(private transport:BybitTransport={socket:url=>new WebSocket(url),now:Date.now}){}
  subscribeExecutions(id:string,consumer:ExecutionConsumer){this.consumers.set(id,consumer);consumer([],this.status,this.liveSince);this.open();return()=>{this.consumers.delete(id);if(!this.consumers.size)this.stop();};}
  private publish(trades:readonly NormalizedExecution[]=[]){for(const consumer of this.consumers.values())consumer(trades,this.status,this.liveSince);}
  private open(){
    if(this.ws||this.retryTimer||!this.online||this.dead||!this.consumers.size)return;
    this.openedAt=this.transport.now();this.liveSince=0;this.status={state:'loading',message:'Connecting to Bybit linear public trades',lastUpdate:0};this.publish();
    let ws:WebSocket;
    try{ws=this.transport.socket('wss://stream.bybit.com/v5/public/linear');}catch{this.reconnect('Bybit socket could not open');return;}
    this.ws=ws;
    ws.onopen=()=>{if(this.ws===ws)ws.send(JSON.stringify({op:'subscribe',args:['publicTrade.BTCUSDT']}));};
    ws.onmessage=event=>{
      if(this.ws!==ws)return;
      try{
        const raw=JSON.parse(String(event.data));if(raw.op==='subscribe'&&raw.success!==true)throw Error('Bybit rejected the trade subscription');
        const trades=parseBybitTrades(raw,this.transport.now());if(!trades.length)return;
        const fresh:NormalizedExecution[]=[];
        for(const trade of trades){const signature=`${trade.timeMs}:${trade.priceText}:${trade.quantityText}:${trade.side}`,prior=this.recent.get(trade.executionId);
          if(prior&&prior!==signature)throw Error('Conflicting Bybit execution identity');if(prior)continue;
          this.recent.set(trade.executionId,signature);if(this.recent.size>8192)this.recent.delete(this.recent.keys().next().value!);fresh.push(trade);}
        const now=this.transport.now();if(!this.liveSince)this.liveSince=now;
        this.attempt=0;this.status={state:'live',message:'Direct Bybit linear · session prints · no backfill',lastUpdate:now};this.publish(fresh);
      }catch(error){this.reconnect(error instanceof Error?error.message:String(error));}
    };
    ws.onerror=()=>{if(this.ws===ws)this.reconnect('Bybit public trade connection failed');};
    ws.onclose=()=>{if(this.ws===ws)this.reconnect('Bybit public trade connection closed; session gap');};
    this.timer=setInterval(()=>{if(this.ws!==ws)return;const age=this.transport.now()-(this.status.lastUpdate||this.openedAt);
      if(age>20000){this.reconnect('Bybit prints stale; session gap');return;}
      if(ws.readyState===1)ws.send(JSON.stringify({op:'ping'}));},10000);
  }
  private reconnect(message:string){this.closeSocket();this.status={...this.status,state:'reconnecting',message};this.publish();
    if(this.online&&!this.dead&&this.consumers.size)this.retryTimer=setTimeout(()=>{this.retryTimer=undefined;this.open();},Math.min(30000,500*2**Math.min(this.attempt++,6)));}
  private closeSocket(){const ws=this.ws;this.ws=undefined;if(ws){ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;ws.close();}clearInterval(this.timer);this.timer=undefined;}
  private stop(){this.closeSocket();clearTimeout(this.retryTimer);this.retryTimer=undefined;this.recent.clear();this.liveSince=0;this.status={state:'loading',message:'Waiting for Bybit prints',lastUpdate:0};}
  setOnline(value:boolean){this.online=value;if(!value){this.stop();this.status={state:'stale',message:'Network offline; Bybit session interrupted',lastUpdate:0};this.publish();}else this.open();}
  retry(){this.stop();this.open();}
  dispose(){this.dead=true;this.stop();this.consumers.clear();}
}

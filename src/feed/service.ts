import { type Candle, type Command, type Event, type Series, type Status, type ConnectionKey, canonicalSeries, connectionKey, keyOf, duration } from './protocol';
import { Reconciler, PatchQueue } from './reconcile';
import { history, HttpError, parseLive, socketURL, subscription } from './adapters';
export interface Transport { history:typeof history; socket:(url:string)=>WebSocket; now:()=>number; random:()=>number }
interface Entry { series:Series; ids:Set<string>; data:Reconciler; queue:PatchQueue; status:Status; generation:number; abort?:AbortController; ready:boolean; retryAt:number; attempts:number; hard:boolean }
interface Connection { ws?:WebSocket; attempts:number; timer?:ReturnType<typeof setTimeout>; heartbeat?:ReturnType<typeof setInterval>; lifetime?:ReturnType<typeof setTimeout>; lastMessage:number; opened:boolean; opening?:ReturnType<typeof setTimeout> }
export class MarketService {
  readonly entries=new Map<string,Entry>();
  private clients=new Map<string,string>();
  private connections=new Map<ConnectionKey,Connection>();
  private wireCommands=new Map<ConnectionKey,Map<string,{series:Series;subscribe:boolean}>>();
  private lastControl=new Map<ConnectionKey,number>();private sequence=0; private online=true; private dead=false;
  private flushTimer:ReturnType<typeof setInterval>;private checkTimer:ReturnType<typeof setInterval>;
  constructor(private emit:(event:Event)=>void,private transport:Transport={history,socket:url=>new WebSocket(url),now:Date.now,random:Math.random}) {
    this.flushTimer=setInterval(()=>this.flush(),50);this.checkTimer=setInterval(()=>this.check(),1000);
  }
  command(c:Command) {
    if(c.type==='subscribe')this.subscribe(c.id,c.series);
    else if(c.type==='unsubscribe')this.unsubscribe(c.id);
    else if(c.type==='retry') { const e=this.entries.get(this.clients.get(c.id)??''); if(e){ e.hard=false;e.attempts=0;this.fetchHistory(e);this.connect(connectionKey(e.series)); } }
    else if(c.type==='online') { this.online=c.online;if(c.online){for(const e of this.entries.values()){if(!e.hard)this.fetchHistory(e);}for(const key of this.connections.keys())this.connect(key);}else{for(const e of this.entries.values())this.state(e,'stale','Offline · waiting for network');for(const key of this.connections.keys())this.closeSocket(key);} }
    else if(c.type==='diagnostics')this.emit({type:'diagnostics',data:this.diagnostics()});
  }
  subscribe(id:string,series:Series) {
    const canonical=canonicalSeries(series);if(!canonical)return;series=canonical;
    this.unsubscribe(id);
    const key=keyOf(series);let e=this.entries.get(key);
    if(!e) { e={series,ids:new Set(),data:new Reconciler(),queue:new PatchQueue(),status:{state:'loading',message:'Loading native candles…',lastUpdate:0},generation:0,ready:false,retryAt:0,attempts:0,hard:false};this.entries.set(key,e); }
    e.ids.add(id);this.clients.set(id,key);
    if(e.data.bars.size)this.emit({type:'snapshot',key,ids:[id],candles:e.data.snapshot()});
    this.emit({type:'status',key,ids:[id],status:e.status});
    if(e.ids.size===1) { this.fetchHistory(e);const key=connectionKey(series);const conn=this.connections.get(key);if(conn?.ws?.readyState===1)this.send(series,true);else this.connect(key); }
  }
  unsubscribe(id:string) {
    const key=this.clients.get(id);this.clients.delete(id);if(!key)return;
    const e=this.entries.get(key);if(!e)return;e.ids.delete(id);
    if(!e.ids.size){const owner=connectionKey(e.series);e.generation++;e.abort?.abort();this.send(e.series,false);this.entries.delete(key);if(!this.active(owner).length){this.closeSocket(owner);this.connections.delete(owner);} }
  }
  private active(owner:ConnectionKey) { return [...this.entries.values()].filter(e=>connectionKey(e.series)===owner); }
  private state(e:Entry,state:Status['state'],message:string) {
    if(e.status.state===state&&e.status.message===message)return;
    e.status={...e.status,state,message};this.emit({type:'status',key:keyOf(e.series),ids:[...e.ids],status:e.status});
  }
  async fetchHistory(e:Entry) {
    if(!this.online||this.dead||e.hard)return;
    if(e.abort)return; // de-duplicate an in-flight initial/repair request
    const generation=++e.generation,abort=new AbortController();e.abort=abort;e.ready=false;e.retryAt=0;
    const timeout=setTimeout(()=>abort.abort(),15000);
    this.state(e,e.data.bars.size?'reconnecting':'loading',e.data.bars.size?'Repairing recent gap…':'Loading native candles…');
    try {
      const latest=e.data.snapshot().at(-1);const start=latest?Math.max(this.transport.now()-duration[e.series.interval]*1000,latest.t-duration[e.series.interval]*3):undefined;
      const bars=await this.transport.history(e.series,abort.signal,start);
      if(this.entries.get(keyOf(e.series))!==e||generation!==e.generation)return;
      e.data.merge(bars);e.ready=true;e.attempts=0;
      e.queue.drain();e.queue.overflow=false;
      this.emit({type:'snapshot',key:keyOf(e.series),ids:[...e.ids],candles:e.data.snapshot()});
      this.state(e,e.status.lastUpdate&&this.transport.now()-e.status.lastUpdate<15000?'live':'stale',e.status.lastUpdate?'History repaired':'History loaded · waiting for live update');
    } catch(error) {
      if(this.entries.get(keyOf(e.series))!==e||generation!==e.generation)return;
      const msg=error instanceof Error?error.message:'History unavailable';
      e.hard=error instanceof HttpError&&error.hard;
      e.attempts++;e.ready=e.data.bars.size>0;
      const rateDelay=error instanceof HttpError?error.retryAfter:0;
      // Hard rejections require explicit Retry. Transient history retries stop after five.
      e.retryAt=!e.hard&&e.attempts<5?this.transport.now()+Math.max(rateDelay,this.backoff(e.attempts)):0;
      this.state(e,e.data.bars.size?'stale':'failed',`${msg}${e.retryAt?' · retrying':' · use Retry'}`);
    } finally {clearTimeout(timeout);if(generation===e.generation)e.abort=undefined;}
  }
  ingest(e:Entry,bars:Candle[]) {
    const changes=e.data.merge(bars);if(!bars.length)return;
    e.status.lastUpdate=this.transport.now();
    if(e.ready&&!e.hard)this.state(e,'live','Native candle stream');
    for(const b of changes)e.queue.add(b);
  }
  flush() {
    this.flushControls();
    for(const [key,e] of this.entries) {
      if(!e.ready)continue;
      const candles=e.queue.drain();
      if(e.queue.overflow){e.queue.overflow=false;this.emit({type:'snapshot',key,ids:[...e.ids],candles:e.data.snapshot()});}
      else if(candles.length)this.emit({type:'patch',key,ids:[...e.ids],candles});
    }
  }
  private backoff(attempt:number) { return Math.min(30000,1000*2**Math.min(attempt,5))*(.75+this.transport.random()*.5); }
  private connect(owner:ConnectionKey) {
    const active=this.active(owner);
    if(this.dead||!this.online||!active.some(e=>!e.hard))return;
    let conn=this.connections.get(owner);
    if(conn?.ws&&conn.ws.readyState<=1)return;
    if(!conn){conn={attempts:0,lastMessage:0,opened:false};this.connections.set(owner,conn);}
    clearTimeout(conn.timer);const current=conn;
    const ws=this.transport.socket(socketURL(active[0]!.series));current.ws=ws;current.opened=false;
    const opening=current.opening=setTimeout(()=>{if(ws.readyState===0)ws.close();},12000);
    ws.onopen=()=>{
      clearTimeout(opening);current.opened=true;current.attempts=0;current.lastMessage=this.transport.now();
      for(const e of this.active(owner)){this.send(e.series,true);if(!e.abort)this.fetchHistory(e);}
      if(owner==='hyperliquid:perpetual')current.heartbeat=setInterval(()=>{if(ws.readyState===1){ws.send(JSON.stringify({method:'ping'}));if(this.transport.now()-current.lastMessage>60000)ws.close();}},25000);
      else current.lifetime=setTimeout(()=>ws.close(),23*60*60*1000+55*60*1000);
    };
    ws.onmessage=event=> {
      current.lastMessage=this.transport.now();
      let raw:unknown;try{raw=JSON.parse(String(event.data));}catch{return;}
      for(const e of this.active(owner))this.ingest(e,parseLive(raw,e.series));
    };
    ws.onerror=()=> { for(const e of this.active(owner))this.state(e,e.data.bars.size?'stale':'reconnecting','WebSocket unavailable'); };
    ws.onclose=()=>{
      this.wireCommands.delete(owner);this.lastControl.delete(owner);
      clearTimeout(opening);clearInterval(current.heartbeat);clearTimeout(current.lifetime);current.ws=undefined;current.opened=false;
      if(this.dead||!this.online||!this.active(owner).length)return;
      current.attempts++;
      for(const e of this.active(owner))this.state(e,e.data.bars.size?'reconnecting':'failed','Connection lost · repairing on reconnect');
      // Stop blind retries after repeated handshakes fail (browser hides HTTP rejection).
      if(current.attempts<=5)current.timer=setTimeout(()=>this.connect(owner),this.backoff(current.attempts));
      else for(const e of this.active(owner))this.state(e,'failed','WebSocket repeatedly rejected · use Retry');
    };
  }
  private send(s:Series,subscribe:boolean) {
    const owner=connectionKey(s),ws=this.connections.get(owner)?.ws;if(ws?.readyState!==1)return;
    if(s.venue==='binance') {
      const queue=this.wireCommands.get(owner)??new Map<string,{series:Series;subscribe:boolean}>();
      queue.set(keyOf(s),{series:s,subscribe});this.wireCommands.set(owner,queue);
    }
    else ws.send(JSON.stringify(subscription(s,subscribe,++this.sequence)));
  }
  private flushControls(){
    const now=this.transport.now();
    for(const [owner,queue] of this.wireCommands) {
      const ws=this.connections.get(owner)?.ws;
      if(!queue.size||ws?.readyState!==1)continue;
      // Spot allows 5 incoming client frames per second; 4 control frames/s leaves room for browser-managed pong frames.
      const minimumInterval=owner==='binance:spot'?250:200;
      if(now-(this.lastControl.get(owner)??0)<minimumInterval)continue;
      for(const subscribe of [false,true]){
        const matching=[...queue.entries()].filter(([,command])=>command.subscribe===subscribe);
        if(!matching.length)continue;
        ws.send(JSON.stringify({method:subscribe?'SUBSCRIBE':'UNSUBSCRIBE',params:matching.map(([,command])=>`btcusdt@kline_${command.series.interval}`),id:String(++this.sequence)}));
        for(const [key]of matching)queue.delete(key);
        this.lastControl.set(owner,now);break;
      }
    }
  }
  private closeSocket(owner:ConnectionKey) {
    this.wireCommands.delete(owner);this.lastControl.delete(owner);const c=this.connections.get(owner);if(!c)return;clearTimeout(c.timer);clearInterval(c.heartbeat);clearTimeout(c.lifetime);
    clearTimeout(c.opening);if(c.ws){c.ws.onclose=null;c.ws.onmessage=null;c.ws.onerror=null;c.ws.onopen=null;c.ws.close();c.ws=undefined;}
  }
  private check() {
    const now=this.transport.now();
    for(const e of this.entries.values()) {
      if(e.status.state==='live')this.emit({type:'status',key:keyOf(e.series),ids:[...e.ids],status:e.status});
      if(e.status.state==='live'&&now-e.status.lastUpdate>15000)this.state(e,'stale','No valid candle update for 15s');
      if(e.retryAt&&now>=e.retryAt)this.fetchHistory(e);
    }
  }
  diagnostics() {return {series:this.entries.size,subscriptions:this.clients.size,sockets:[...this.connections.values()].filter(c=>c.ws&&c.ws.readyState<=1).length,caches:[...this.entries].map(([key,e])=>({key,bars:e.data.bars.size,clients:e.ids.size,pending:e.queue.size})),inactiveCaches:0};}
  dispose(){this.dead=true;clearInterval(this.flushTimer);clearInterval(this.checkTimer);for(const e of this.entries.values()){e.generation++;e.abort?.abort();}for(const owner of this.connections.keys())this.closeSocket(owner);this.entries.clear();this.clients.clear();}
}

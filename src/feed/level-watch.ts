import type {WatchCommand,WatchDelivery,WatchMessage,WatchSnapshot} from '../level-watch/types';
/** One shared transport in the feed worker; never a direct-venue fallback. */
export class LevelWatchTransport {
  private socket?:WebSocket;private started=false;private retry?:ReturnType<typeof setTimeout>;private delay=1000;private token='';private active=0;private cursor=0;private initialized=false;private generation=0;private frame=0;private pending?:WatchDelivery;private lastMessage=0;private watchdog?:ReturnType<typeof setInterval>;
  constructor(private emit:(message:WatchMessage)=>void,private enabled:()=>boolean){}
  command(c:WatchCommand){
    if(!this.enabled()){const error='Level Watch requires staging data mode and the private SSH tunnel';this.emit(c.type==='watch-rpc'?{type:'watch-result',id:c.id,error}:{type:'watch-state',error});return;}
    if(c.type==='watch-start'){if(!this.started){this.started=true;this.watchdog=setInterval(()=>{if(this.socket&&Date.now()-this.lastMessage>5000){this.emit({type:'watch-state',error:'Watch stream stale; reconnecting'});this.socket.close();}},1000);void this.connect();}return;}
    if(c.type==='watch-ack'){
      const p=this.pending,socket=this.socket;
      // Local application callbacks belong to one delivered frame on one socket.
      // Bootstrap, duplicate and superseded-generation callbacks cannot send ACKs.
      if(!this.started||!p||c.generation!==this.generation||c.generation!==p.generation||c.frame!==p.frame||c.cursor!==p.cursor||!Number.isSafeInteger(c.cursor)||c.cursor<this.cursor||socket?.readyState!==WebSocket.OPEN)return;
      try{socket.send(JSON.stringify({type:'ack',cursor:p.cursor}));this.cursor=p.cursor;this.pending=undefined;}catch{socket.close();}return;
    }
    if(this.active>=8){this.emit({type:'watch-result',id:c.id,error:'Watch request capacity; retry'});return;}
    this.active++;void this.request(c.path,c.body,c.key).then(value=>this.emit({type:'watch-result',id:c.id,value}),error=>this.emit({type:'watch-result',id:c.id,error:String(error.message)})).finally(()=>this.active--);
  }
  private async request(path:string,body?:unknown,key?:string):Promise<unknown>{
    if(!/^\/(?:[a-zA-Z0-9%_:/?.=&-]*)$/.test(path)&&path!=='')throw new Error('Invalid watch path');
    if(body!==undefined&&!this.token){const session=await this.request('/session') as {csrf:string};this.token=session.csrf;}
    const response=await fetch('/market-data/v1/level-watches'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-IQ-CSRF':this.token,'Idempotency-Key':key!},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    const value=await response.json();if(!response.ok){if(value.error==='Session token required')this.token='';throw new Error(value.error??`HTTP ${response.status}`);}return value;
  }
  private async connect(){const generation=++this.generation;this.pending=undefined;try{
    const snapshot=await this.request('') as WatchSnapshot;if(!this.started||generation!==this.generation)return;
    if(snapshot.version!==1||!Array.isArray(snapshot.watches)||snapshot.watches.length>100||!Number.isSafeInteger(snapshot.cursor)||snapshot.cursor<0)throw Error('Invalid watch bootstrap');
    // Initial history is silent presentation, not a WebSocket delivery/ACK.
    if(!this.initialized){this.cursor=snapshot.cursor;this.initialized=true;}
    this.emit({type:'watch-state',snapshot:{...snapshot,events:[]}});
    const url=new URL('/market-data/v1/level-watches/stream',self.location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    this.lastMessage=Date.now();const socket=this.socket=new WebSocket(url);
    const current=()=>this.started&&generation===this.generation&&this.socket===socket;
    socket.onopen=()=>{if(!current())return;this.delay=1000;socket.send(JSON.stringify({type:'subscribe',after:this.cursor}));};
    socket.onmessage=event=>{if(!current())return;this.lastMessage=Date.now();try{
      const data=JSON.parse(event.data) as WatchSnapshot&{type:string};
      if(data.type!=='level-watch'||data.version!==1||!Array.isArray(data.watches)||data.watches.length>100||!Array.isArray(data.events)||!Number.isSafeInteger(data.cursor)||data.cursor<this.cursor||this.pending)throw Error('Invalid watch stream');
      let eventCursor=this.cursor;for(const event of data.events){if(!Number.isSafeInteger(event.id)||event.id<=eventCursor||event.id>data.cursor)throw Error('Invalid watch event cursor');eventCursor=event.id;}
      const delivery=this.pending={generation,frame:++this.frame,cursor:data.cursor};this.emit({type:'watch-state',snapshot:data,delivery:{...delivery}});
    }catch{socket.close();}};
    socket.onerror=()=>{if(current())socket.close();};socket.onclose=()=>{if(current()){this.socket=undefined;this.pending=undefined;this.reconnect('Watch connection interrupted; server monitoring continues');}};
  }catch(error){if(this.started&&generation===this.generation)this.reconnect(error instanceof Error?error.message:'Watch connection unavailable');}}
  private reconnect(error:string){if(!this.started)return;this.emit({type:'watch-state',error});clearTimeout(this.retry);this.retry=setTimeout(()=>void this.connect(),this.delay);this.delay=Math.min(30000,this.delay*2);}
  dispose(){this.started=false;this.generation++;this.pending=undefined;clearTimeout(this.retry);clearInterval(this.watchdog);this.socket?.close();this.socket=undefined;}
}

import type {WatchCommand,WatchMessage,WatchSnapshot} from '../level-watch/types';
/** One shared transport in the feed worker; never a direct-venue fallback. */
export class LevelWatchTransport {
  private socket?:WebSocket;private started=false;private retry?:ReturnType<typeof setTimeout>;private delay=1000;private token='';private active=0;private cursor=0;private generation=0;private lastMessage=0;private watchdog?:ReturnType<typeof setInterval>;
  constructor(private emit:(message:WatchMessage)=>void,private enabled:()=>boolean){}
  command(c:WatchCommand){
    if(!this.enabled()){const error='Level Watch requires staging data mode and the private SSH tunnel';this.emit(c.type==='watch-rpc'?{type:'watch-result',id:c.id,error}:{type:'watch-state',error});return;}
    if(c.type==='watch-start'){if(!this.started){this.started=true;this.watchdog=setInterval(()=>{if(this.socket&&Date.now()-this.lastMessage>5000){this.emit({type:'watch-state',error:'Watch stream stale; reconnecting'});this.socket.close();}},1000);void this.connect();}return;}
    if(c.type==='watch-ack'){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({type:'ack',cursor:c.cursor}));this.cursor=c.cursor;return;}
    if(this.active>=8){this.emit({type:'watch-result',id:c.id,error:'Watch request capacity; retry'});return;}
    this.active++;void this.request(c.path,c.body,c.key).then(value=>this.emit({type:'watch-result',id:c.id,value}),error=>this.emit({type:'watch-result',id:c.id,error:String(error.message)})).finally(()=>this.active--);
  }
  private async request(path:string,body?:unknown,key?:string):Promise<unknown>{
    if(!/^\/(?:[a-zA-Z0-9%_:/?.=&-]*)$/.test(path)&&path!=='')throw new Error('Invalid watch path');
    if(body!==undefined&&!this.token){const session=await this.request('/session') as {csrf:string};this.token=session.csrf;}
    const response=await fetch('/market-data/v1/level-watches'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-IQ-CSRF':this.token,'Idempotency-Key':key!},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    const value=await response.json();if(!response.ok){if(value.error==='Session token required')this.token='';throw new Error(value.error??`HTTP ${response.status}`);}return value;
  }
  private async connect(){const generation=++this.generation;try{
    const snapshot=await this.request('') as WatchSnapshot;if(!this.started||generation!==this.generation)return;
    // Initial history is silent. Reconnect resumes immutable events from the last acknowledged cursor.
    if(!this.cursor)this.cursor=snapshot.cursor;this.emit({type:'watch-state',snapshot:{...snapshot,events:[]}});
    const url=new URL('/market-data/v1/level-watches/stream',self.location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    this.lastMessage=Date.now();const socket=this.socket=new WebSocket(url);socket.onopen=()=>{this.delay=1000;socket.send(JSON.stringify({type:'subscribe',after:this.cursor}));};
    socket.onmessage=event=>{this.lastMessage=Date.now();try{const data=JSON.parse(event.data) as WatchSnapshot;if(data.version!==1||!Array.isArray(data.watches)||data.watches.length>100||!Number.isSafeInteger(data.cursor))throw new Error('Invalid watch stream');this.emit({type:'watch-state',snapshot:data});}catch{socket.close();}};
    socket.onerror=()=>socket.close();socket.onclose=()=>{if(this.socket===socket){this.socket=undefined;this.reconnect('Watch connection interrupted; server monitoring continues');}};
  }catch(error){this.reconnect(error instanceof Error?error.message:'Watch connection unavailable');}}
  private reconnect(error:string){if(!this.started)return;this.emit({type:'watch-state',error});clearTimeout(this.retry);this.retry=setTimeout(()=>void this.connect(),this.delay);this.delay=Math.min(30000,this.delay*2);}
  dispose(){this.started=false;this.generation++;clearTimeout(this.retry);clearInterval(this.watchdog);this.socket?.close();this.socket=undefined;}
}

import {historyScheduler} from './history-scheduler';import {HistoryTileCache,type TileCache} from './history-tile-cache';import {duration,type Interval,type FootprintBar} from './protocol';
export class PreparedFootprints {
 constructor(private request:typeof fetch=(...a)=>fetch(...a),private cache:TileCache=new HistoryTileCache()){}
 async load(from:number,to:number,interval:Interval,rowPrice:number,signal:AbortSignal,publish:(bars:FootprintBar[],complete:boolean,validated:boolean)=>void){
  const step=duration[interval],key=(start:number)=>`footprint:binance:perpetual:BTCUSDT:aggregate-trade:1:${step}:${Math.round(rowPrice*10)}:${start}`;
  const starts:number[]=[];for(let t=from;t<to;t+=step)starts.push(t);const saved=await this.cache.getMany(starts.map(key)),tiles=new Map<number,any>();for(const t of starts)if(saved.has(key(t)))tiles.set(t,saved.get(key(t)));
  if(tiles.size&&!signal.aborted)publish([...tiles.values()].flatMap(t=>t.bar?[{...t.bar,revision:t.revision}]:[]),false,false);
  for(;;){if(signal.aborted)throw new DOMException('Aborted','AbortError');let pending=false;
   for(let start=from;start<to;start+=14400000){const end=Math.min(to,start+14400000),known=[...tiles].filter(([t])=>t>=start&&t<end).map(([t,v])=>`${t}:${v.revision}`).join(',');const p=new URLSearchParams({from:String(start),to:String(end),interval,rowPrice:String(rowPrice),known});const url='/market-data/v2/history/footprints?'+p;
    const data=await historyScheduler.read(url,'footprint',signal,async shared=>{const r=await this.request(url,{signal:AbortSignal.any([shared,AbortSignal.timeout(30000)])});const data=await r.json();if(!r.ok)throw Error(data.error??`Footprint history HTTP ${r.status}`);return data;});if(data.version!==1||data.feed!=='binance:perpetual:BTCUSDT:aggregate-trade'||!Array.isArray(data.tiles)||data.tiles.length>300)throw Error('Invalid prepared footprints');
    const updates:{key:string;value:any}[]=[];for(const tile of data.tiles){if(!Number.isSafeInteger(tile.from)||tile.from<start||tile.from>=end||tile.from%step||!Number.isSafeInteger(tile.revision))throw Error('Invalid footprint tile identity');if(Object.hasOwn(tile,'bar')){tiles.set(tile.from,tile);updates.push({key:key(tile.from),value:tile});}else if(tiles.get(tile.from)?.revision!==tile.revision)throw Error('Missing validated footprint tile');}
    await this.cache.putMany(updates);if(data.state==='unavailable')throw Error('Historical footprint build unavailable; inspect staging materializer backlog');pending||=data.state==='building';
   }
   if(!signal.aborted)publish([...tiles.values()].flatMap(t=>t.bar?[{...t.bar,revision:t.revision}]:[]),!pending,true);if(!pending)return;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,1000);function done(){signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(new DOMException('Aborted','AbortError'));}signal.addEventListener('abort',cancel,{once:true});});
  }
 }
 dispose(){this.cache.dispose?.();}
}

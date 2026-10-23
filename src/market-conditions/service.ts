import { duration, keyOf, type Candle, type Event, type Series, type Status } from '../feed/protocol';
import { ConditionsEngine, type ConditionsPoint } from './engine';
import { calculationKey, type ConditionsSettings } from './settings';
export interface ConditionsUpdate { points:readonly ConditionsPoint[]; changed:readonly ConditionsPoint[]; reset:boolean; corrected:boolean; initial:boolean; status:Status|null; forming:Candle|null }
export interface CandleSource { subscribe(id:string,series:Series,callback:(event:Event)=>void):()=>void }
interface Entry { engine:ConditionsEngine; listeners:Set<(update:ConditionsUpdate)=>void>; release:()=>void; initialized:boolean; status:Status|null; forming:Candle|null }
/** One calculation per canonical source/timeframe/settings, fed through the existing shared worker candle service. */
export class ConditionsService {
  private entries=new Map<string,Entry>();private sequence=0;
  constructor(private source:CandleSource){}
  subscribe(series:Series,settings:ConditionsSettings,listener:(update:ConditionsUpdate)=>void){
    const key=`${keyOf(series)}:${calculationKey(settings)}`;let entry=this.entries.get(key);
    if(!entry){
      entry={engine:new ConditionsEngine(settings,duration[series.interval]),listeners:new Set(),release:()=>{},initialized:false,status:null,forming:null};this.entries.set(key,entry);
      const e=entry;
      e.release=this.source.subscribe(`market-conditions-${++this.sequence}`,series,event=>{
        if(event.type==='status'){const changed=e.status?.state!==event.status.state||e.status?.message!==event.status.message;e.status=event.status;if(changed)this.publish(e,[],false,false,false);return;}
        if(event.type!=='snapshot'&&event.type!=='patch')return;
        const tail=event.candles.at(-1);if(tail&&!tail.closed)e.forming=tail;else if(tail?.closed&&e.forming&&tail.t>=e.forming.t)e.forming=null;
        const initial=!e.initialized;const result=e.engine.update(event.candles);e.initialized=true;
        // Intrabar OHLC updates never recalculate or invalidate confirmed plots.
        if(initial||result.changed.length)this.publish(e,result.changed,result.reset,initial,result.corrected);
      });
    }
    entry.listeners.add(listener);
    listener({points:entry.engine.points,changed:[],reset:true,corrected:false,initial:true,status:entry.status,forming:entry.forming});
    const owned=entry;return ()=>{owned.listeners.delete(listener);if(!owned.listeners.size){owned.release();this.entries.delete(key);}};
  }
  private publish(e:Entry,changed:readonly ConditionsPoint[],reset:boolean,initial:boolean,corrected:boolean){const update={points:e.engine.points,changed,reset,initial,corrected,status:e.status,forming:e.forming};for(const listener of e.listeners)listener(update);}
  diagnostics(){return [...this.entries].map(([key,e])=>({key,consumers:e.listeners.size,points:e.engine.points.length,processed:e.engine.processed,rebuilds:e.engine.rebuilds}));}
  dispose(){for(const e of this.entries.values())e.release();this.entries.clear();}
}
const shared=new WeakMap<CandleSource,ConditionsService>();
export function conditionsService(feed:CandleSource){let service=shared.get(feed);if(!service){service=new ConditionsService(feed);shared.set(feed,service);}return service;}

import type { BinanceFootprintService } from '../feed/footprint-service';
import { marketOf, type Series, type Status } from '../feed/protocol';
import { EffortEngine, type SavedEffort, type EffortEvent, type Point, type EventState } from './engine';
import { BINANCE_EFFORT, effortSettings, sourceKey, type EffortSettings } from './settings';
import { EffortStore } from './storage';
export interface EffortUpdate { type:'effort-result';ids:string[];key:string;events:EffortEvent[];points:Point[];status:string;storage:'durable'|'session-only'|'loading';ready:boolean;references:number;ranges:number;notifications:{id:string;state:EventState;at:number;text:string}[];diagnostics:Record<string,number> }
export interface EffortExport {type:'effort-export';ids:string[];snapshot?:SavedEffort;error?:string}
export interface EffortClaim {type:'effort-claim';ids:string[];accepted:boolean;error?:string}
export type EffortCommand={type:'effort-claim';id:string;key:string;eventId:string;state:EventState}|{type:'effort-alerted';key:string;eventId:string;state:EventState;at:number}|{type:'effort-export';id:string;key:string}|{type:'effort-subscribe';id:string;series:Series;settings:EffortSettings}|{type:'effort-unsubscribe';id:string};
interface Entry { engine:EffortEngine;consumers:Map<string,EffortSettings>;release:()=>void;storage:EffortUpdate['storage'];status:Status|null;epoch:number;lastId?:number;dirty:boolean;lastSave:number;publishing:boolean;removed:boolean;quality?:number }
export class EffortService {
 private entries=new Map<string,Entry>();private clients=new Map<string,string>();private timer?:ReturnType<typeof setInterval>;private store=new EffortStore();
 constructor(private feed:BinanceFootprintService,private emit:(e:EffortUpdate|EffortExport)=>void,private now=Date.now){}
 subscribe(id:string,series:Series,raw:unknown,disabled=false){this.unsubscribe(id);const settings=effortSettings(raw);if(disabled||series.venue!=='binance'||marketOf(series)!=='perpetual'){this.emit({type:'effort-result',ids:[id],key:'unavailable',events:[],points:[],status:disabled?'Unavailable in candle fixtures · select explicit Effort–Result replay inputs':'Unavailable · Release 1 supports Binance BTCUSDT USD-M executions only',storage:'session-only',ready:false,references:0,ranges:0,notifications:[],diagnostics:{}});return;}
  const key=sourceKey(BINANCE_EFFORT,settings);this.clients.set(id,key);let e=this.entries.get(key);if(e){e.consumers.set(id,settings);e.engine.settings.retentionDays=Math.max(...[...e.consumers.values()].map(s=>s.retentionDays));e.dirty=true;return;}
  e={engine:new EffortEngine({...BINANCE_EFFORT},settings),consumers:new Map([[id,settings]]),release:()=>{},storage:'loading',status:null,epoch:0,dirty:true,lastSave:0,publishing:false,removed:false};this.entries.set(key,e);void this.start(e);
  this.timer??=setInterval(()=>{for(const e of this.entries.values())if(e.dirty)void this.publish(e);},250);
 }
 private async start(e:Entry){try{const saved=await this.store.load(e.engine.key);if(saved)e.engine.restore(saved,this.now());e.storage='durable';}catch{e.storage='session-only';}if(e.removed)return;
  e.release=this.feed.subscribeExecutions(`effort:${e.engine.key}`,(trades,status,epoch,integrity)=>{
   const now=this.now();if(e.epoch&&e.epoch!==epoch){e.engine.interrupt(now,'Source epoch changed');e.lastId=undefined;}e.epoch=epoch;const statusChanged=e.status?.state!==status.state||e.status?.message!==status.message;e.status=status;const before=e.engine.points.at(-1)?.time;
   if(integrity?.tickSize&&integrity.tickSize!==e.engine.source.tickSize){e.engine.interrupt(now,'Exchange tick metadata changed · unsupported configuration');e.dirty=true;return;}
   if(integrity&&e.quality!==undefined&&integrity.qualityRevision!==e.quality){e.dirty=true;if(integrity.correctionTime!==undefined)e.engine.correct(now,integrity.correctionTime,'Upstream late execution / invalidated reference');else e.engine.interrupt(now,'Upstream coverage interruption');}e.quality=integrity?.qualityRevision;
   if(status.state==='stale'||status.state==='failed')e.engine.interrupt(now,status.message);
   for(const trade of trades){if(e.lastId!==undefined&&trade.id>e.lastId+1)e.engine.interrupt(now,'Aggregate execution sequence gap');e.lastId=Math.max(e.lastId??trade.id,trade.id);e.engine.ingest(trade,now,String(epoch));}
   e.engine.advance(now);e.dirty ||= statusChanged||before!==e.engine.points.at(-1)?.time;
  });
 }
 private async publish(e:Entry){if(e.publishing||e.removed||e.storage==='loading')return;e.publishing=true;e.dirty=false;try{
  const notifications:EffortUpdate['notifications']=[],now=this.now();for(const event of e.engine.events){const states:EventState[]=event.state==='detected'?['detected']:['detected',event.state];for(const state of states){if(event.notified.includes(state))continue;event.notified.push(state);const at=state==='detected'?event.initial.availableAt:event.outcomeAvailableAt!;const enabled=[...e.consumers.values()].some(s=>state==='detected'?s.candidateAlerts:s.outcomeAlerts);if(enabled&&now-at<=3000&&at<=now){notifications.push({id:event.id,state,at,text:eventLabel(event)});}}}
  if(notifications.length||now-e.lastSave>=30000){try{await this.store.save(e.engine.save(now));e.storage='durable';e.lastSave=now;}catch{e.storage='session-only';}}
  if(e.removed)return;this.emit({type:'effort-result',ids:[...e.consumers.keys()],key:e.engine.key,events:e.engine.events,points:e.engine.points.slice(-1800),status:(e.status?.state==='failed'||e.status?.state==='stale'?e.status.message:e.engine.last.reason)+(e.engine.capacityCount?` · ${e.engine.capacityCount} capacity warnings`:''),storage:e.storage,ready:e.engine.last.value!==null,references:e.engine.last.references,ranges:e.engine.last.ranges,notifications,diagnostics:e.engine.diagnostics()});
 }finally{e.publishing=false;}}
 unsubscribe(id:string){const key=this.clients.get(id);this.clients.delete(id);const e=key?this.entries.get(key):undefined;if(!e)return;e.consumers.delete(id);if(e.consumers.size)return;e.removed=true;e.engine.interrupt(this.now(),'Last calculation consumer removed');e.release();if(e.storage!=='loading')void this.store.save(e.engine.save(this.now())).catch(()=>{});this.entries.delete(key!);if(!this.entries.size){clearInterval(this.timer);this.timer=undefined;}}
 alerted(key:string,eventId:string,state:EventState,at:number){const entry=this.entries.get(key),event=entry?.engine.events.find(e=>e.id===eventId);if(!entry||!event||!event.notified.includes(state)||event.alertedAt[state]!==undefined||!Number.isFinite(at))return;event.alertedAt[state]=at;entry.dirty=true;entry.lastSave=0;}
 export(id:string,key:string){const entry=this.entries.get(key);this.emit({type:'effort-export',ids:[id],...(entry?{snapshot:entry.engine.save(this.now())}:{error:'Calculation is no longer attached; re-add the indicator to export.'})});}
 diagnostics(){return [...this.entries].map(([key,e])=>({key,consumers:e.consumers.size,storage:e.storage,...e.engine.diagnostics()}));}
 dispose(){for(const id of [...this.clients.keys()])this.unsubscribe(id);}
}
export function eventLabel(e:EffortEvent){return e.initial.side===1?'Buy flow stalled — potential passive selling':'Sell flow stalled — potential passive buying';}

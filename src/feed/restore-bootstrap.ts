import type {SerializedDockview} from 'dockview-core';
import type {FeedClient} from './client';
import {duration,keyOf,footprintKeyOf,type Series} from './protocol';
export interface RestoreFeedSelection extends Series {type:'candle'|'footprint';rowPrice:number;historyViewport?:{from:number;to:number};indicators:Array<{definitionId:string;visible:boolean;settings:unknown}>}
import {orderWallMarket,orderWallsSettings} from './order-walls';
let restoreSequence=0;
/** Join the same worker groups before synchronous chart construction. Temporary
 * consumers hold the cursor until the real visible panels have subscribed. */
export function startVisibleChartFeeds(feed:Pick<FeedClient,'subscribe'|'subscribeFootprint'|'subscribeOrderWalls'>&Partial<Pick<FeedClient,'requestFootprintViewport'>>,layout:SerializedDockview,normalize:(value:unknown)=>RestoreFeedSelection,preloadHistory=false){
 const scope=`restore-${++restoreSequence}`;
 const visible=new Set<string>(),releases:Array<()=>void>=[];
 const visit=(node:any)=>{if(node?.type==='leaf'){const id=node.data?.activeView??node.data?.views?.[0];if(typeof id==='string')visible.add(id);}else for(const child of node?.data??[])visit(child);};visit(layout.grid.root);
 try{for(const id of [...visible].slice(0,8)){
  const panel=layout.panels[id];if(panel?.contentComponent!=='candle')continue;
  const selection=normalize(panel.params);if(selection.venue!=='binance')continue;
  releases.push(feed.subscribe(`${scope}:native:${id}`,selection,()=>{}));
  if(selection.type==='footprint'||selection.indicators.some(i=>i.definitionId==='native.footprint-totals'&&i.visible)){
   const token=`${scope}:footprint:${id}`;releases.push(feed.subscribeFootprint(token,selection,selection.rowPrice,()=>{}));
   if(preloadHistory){const end=Math.floor(Date.now()/duration[selection.interval])*duration[selection.interval],range=(selection.type==='footprint'?selection.historyViewport:undefined)??{from:end-4*3600000,to:end};feed.requestFootprintViewport?.(token,range.from,range.to);}
  }
  const wall=selection.indicators.find(i=>i.definitionId==='native.order-walls'&&i.visible);
  if(wall){const settings=orderWallsSettings(wall.settings);if(settings.enabled&&settings.mode==='top-levels'){
   const now=Date.now();releases.push(feed.subscribeOrderWalls(`${scope}:walls:${id}`,{market:orderWallMarket(selection),from:now-60000,to:now+60000,followLive:true,currentOnly:true,settings},()=>{}));
  }}
 }}catch(error){for(const release of releases.reverse())release();throw error;}
 let released=false;return()=>{if(released)return;released=true;for(const release of releases.reverse())release();};
}

/** Compare authoritative UI sources before handing temporary consumers over. */
export function restoreFeedPlan(layout:SerializedDockview,normalize:(value:unknown)=>RestoreFeedSelection){
 const keys:string[]=[];
 const visit=(node:any)=>{if(node?.type==='leaf'){
  const id=node.data?.activeView??node.data?.views?.[0],panel=layout.panels[id];if(panel?.contentComponent!=='candle')return;
  const s=normalize(panel.params);if(s.venue!=='binance')return;keys.push(keyOf(s));
  if(s.type==='footprint'||s.indicators.some(i=>i.definitionId==='native.footprint-totals'&&i.visible))keys.push(footprintKeyOf(s,s.rowPrice)+':'+JSON.stringify(s.historyViewport??null));
  const wall=s.indicators.find(i=>i.definitionId==='native.order-walls'&&i.visible);if(wall)keys.push('walls:'+JSON.stringify([s.market,orderWallsSettings(wall.settings)]));
 }else for(const child of node?.data??[])visit(child);};visit(layout.grid.root);return keys.sort().join('|');
}

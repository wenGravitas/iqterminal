import type {SerializedDockview} from 'dockview-core';
import type {FeedClient} from './client';
import type {PanelConfig} from '../panel';
import {orderWallMarket,orderWallsSettings} from './order-walls';
let restoreSequence=0;
/** Join the same worker groups before synchronous chart construction. Temporary
 * consumers hold the cursor until the real visible panels have subscribed. */
export function startVisibleChartFeeds(feed:Pick<FeedClient,'subscribe'|'subscribeFootprint'|'subscribeOrderWalls'>,layout:SerializedDockview,normalize:(value:unknown)=>PanelConfig){
 const scope=`restore-${++restoreSequence}`;
 const visible=new Set<string>(),releases:Array<()=>void>=[];
 const visit=(node:any)=>{if(node?.type==='leaf'){const id=node.data?.activeView??node.data?.views?.[0];if(typeof id==='string')visible.add(id);}else for(const child of node?.data??[])visit(child);};visit(layout.grid.root);
 try{for(const id of [...visible].slice(0,8)){
  const panel=layout.panels[id];if(panel?.contentComponent!=='candle')continue;
  const selection=normalize(panel.params);if(selection.venue!=='binance')continue;
  releases.push(feed.subscribe(`${scope}:native:${id}`,selection,()=>{}));
  if(selection.type==='footprint'||selection.indicators.some(i=>i.definitionId==='native.footprint-totals'&&i.visible))releases.push(feed.subscribeFootprint(`${scope}:footprint:${id}`,selection,selection.rowPrice,()=>{}));
  const wall=selection.indicators.find(i=>i.definitionId==='native.order-walls'&&i.visible);
  if(wall){const settings=orderWallsSettings(wall.settings);if(settings.enabled&&settings.mode==='top-levels'){
   const now=Date.now();releases.push(feed.subscribeOrderWalls(`${scope}:walls:${id}`,{market:orderWallMarket(selection),from:now-60000,to:now+60000,followLive:true,currentOnly:true,settings},()=>{}));
  }}
 }}catch(error){for(const release of releases.reverse())release();throw error;}
 let released=false;return()=>{if(released)return;released=true;for(const release of releases.reverse())release();};
}

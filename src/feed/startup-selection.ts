import {canonicalSeries,canonicalFootprintRowPrice,validFootprintRowPrice,FOOTPRINT_DEFAULT_ROW_PRICE,legacyFootprintRowTicks} from './protocol';
import {orderWallsSettings} from './order-walls';
import {parseRegistry,validatedLayout,WORKSPACE_KEY} from '../workspaces/model';
import {restoreValue,STORAGE_KEY} from '../layout';
import type {RestoreFeedSelection} from './restore-bootstrap';
/** Read only. WorkspaceManager remains the owner of recovery, migration and writes. */
export function startupLayout(storage:Pick<Storage,'getItem'>){
 let raw:string|null=null,legacy:string|null=null;
 try{raw=storage.getItem(WORKSPACE_KEY);legacy=storage.getItem(STORAGE_KEY);}catch{return null;}
 if(raw)try{
  const registry=parseRegistry(raw),active=registry.workspaces.find(w=>w.id===registry.activeId)!;
  for(const w of [active,...registry.workspaces.filter(w=>w!==active)])try{return validatedLayout(w.layout);}catch{/* Same candidate order as WorkspaceManager.start. */}
  return null;
 }catch{/* Corrupt registry falls back to the preserved legacy layout. */}
 return restoreValue(legacy);
}
/** Conservative source-only projection. Full chart configuration still belongs
 * to the UI. Unknown versions remain recoverable and never start speculative reads. */
export function startupSelection(value:unknown):RestoreFeedSelection {
 const raw=value&&typeof value==='object'?value as Record<string,any>:{},series=canonicalSeries(raw);
 if(!series)throw Error('Invalid startup chart series');
 const baseRow=validFootprintRowPrice(raw.rowPrice)?canonicalFootprintRowPrice(raw.rowPrice):Object.hasOwn(raw,'rowPrice')?FOOTPRINT_DEFAULT_ROW_PRICE
  :legacyFootprintRowTicks.includes(raw.rowTicks)&&raw.rowTicks!==10?Number(raw.rowTicks)*.1:FOOTPRINT_DEFAULT_ROW_PRICE;
 let rowPrice=baseRow,footprint=raw.type==='footprint',totals=false;const indicators:RestoreFeedSelection['indicators']=[];
 if(Array.isArray(raw.indicators)){
  footprint=false;const ids=new Set<string>(),singletons=new Set<string>();
  for(const item of raw.indicators.slice(0,24)){
   if(!item||typeof item!=='object'||typeof item.instanceId!=='string'||!item.instanceId||item.instanceId.length>120
    ||typeof item.definitionId!=='string'||item.definitionId.length>160||!Number.isInteger(item.settingsVersion)||item.settingsVersion<1
    ||!item.settings||typeof item.settings!=='object'||Array.isArray(item.settings)||ids.has(item.instanceId))continue;
   try{if(JSON.stringify(item).length>12000)continue;}catch{continue;}
   ids.add(item.instanceId);
   const known=['native.footprint','native.footprint-totals','native.order-walls'].includes(item.definitionId);
   if(!known||singletons.has(item.definitionId))continue;singletons.add(item.definitionId);
   const source=item.source&&typeof item.source==='object'&&typeof item.source.kind==='string'?item.source.kind:'chart';
   if(source!=='chart')continue;
   if(item.definitionId==='native.footprint'&&item.settingsVersion===1){
    rowPrice=validFootprintRowPrice(item.settings.rowPrice)?canonicalFootprintRowPrice(item.settings.rowPrice):FOOTPRINT_DEFAULT_ROW_PRICE;
    footprint=item.visible!==false;
   }
   if(item.definitionId==='native.footprint-totals'&&item.settingsVersion===1)totals=item.visible!==false;
   if(item.definitionId==='native.order-walls'&&[1,2].includes(item.settingsVersion))indicators.push({definitionId:item.definitionId,visible:item.visible!==false,
    settings:orderWallsSettings(item.settingsVersion===1&&!('mode' in item.settings)?{...item.settings,mode:'threshold'}:item.settings)});
  }
 }
 if(totals)indicators.push({definitionId:'native.footprint-totals',visible:true,settings:{}});
 const viewport=raw.historyViewport;
 const historyViewport=viewport&&Number.isSafeInteger(viewport.from)&&Number.isSafeInteger(viewport.to)&&viewport.from>0&&viewport.to>viewport.from&&viewport.to-viewport.from<=7*86400000?{from:viewport.from,to:viewport.to}:undefined;
 return {...series,type:footprint?'footprint':'candle',rowPrice,indicators,historyViewport};
}

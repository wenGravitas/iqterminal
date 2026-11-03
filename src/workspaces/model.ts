import type { SerializedDockview } from 'dockview-core';
import { restoreValue } from '../layout';
export const WORKSPACE_KEY = 'iqterminal:workspaces:v1';
export const WORKSPACE_LIMIT = 64;
export const WORKSPACE_ICONS = { chart:'M2 14h14M3 11l4-5 4 3 4-6', bars:'M3 14V8m4 6V3m4 11V6m4 8V1', layers:'m2 6 7-4 7 4-7 4Zm0 4 7 4 7-4', target:'M9 2v14M2 9h14M3 9a6 6 0 1 0 12 0 6 6 0 1 0-12 0', market:'M2 15h14M4 15V7m5 8V7m5 8V7M2 6l7-4 7 4Z', wave:'M1 9c4-12 4 12 8 0s4 12 8 0', grid:'M2 2h14v14H2ZM2 9h14M9 2v14', star:'m9 2 2 5 5 .5-4 3.5 1 5-4-2.5L5 16l1-5L2 7.5 5 7Z' } as const;
export type WorkspaceIcon = string;
export interface Workspace { id:string; name:string; icon:WorkspaceIcon; pinned:boolean; pinOrder:number; createdAt:number; updatedAt:number; layout:SerializedDockview; panelState:Record<string,string> }
export interface WorkspaceRegistry { version:1; revision:number; activeId:string; workspaces:Workspace[] }
export function validIcon(value:unknown): value is string { return typeof value==='string' && (Object.hasOwn(WORKSPACE_ICONS,value)||/^[A-Z0-9]$/.test(value)); }
export function workspaceName(value:string) { const name=value.trim(); if(!name||name.length>80||/[\u0000-\u001f]/.test(name))throw Error('Use a workspace name between 1 and 80 characters.');return name; }
export function validatedLayout(layout:unknown) { const result=restoreValue(JSON.stringify({version:9,layout}));if(!result)throw Error('Workspace layout is invalid or exceeds widget limits. Saved data was preserved.');return structuredClone(result); }
export function panelStorageId(key:string):string|null { const match=/^iqterminal:(?:drawings|object-tree:v1|object-tree-sidebar:v1):([^:]+)(?::|$)/.exec(key);if(!match)return null;try {const id=decodeURIComponent(match[1]!);return /^chart-[a-z0-9-]+$/i.test(id)?id:null;}catch{return null;} }
export function parseRegistry(raw:string):WorkspaceRegistry {
  if(raw.length>16_000_000)throw Error('Workspace registry exceeds its size limit.');const value=JSON.parse(raw);if(value?.version!==1||!Array.isArray(value.workspaces)||!value.workspaces.length||value.workspaces.length>WORKSPACE_LIMIT||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('Unsupported or corrupt workspace registry.');
  const ids=new Set<string>(),panels=new Set<string>();for(const w of value.workspaces){if(!/^workspace-[a-z0-9-]+$/i.test(w.id)||ids.has(w.id)||workspaceName(w.name)!==w.name||!validIcon(w.icon)||typeof w.pinned!=='boolean'||!Number.isInteger(w.pinOrder)||w.pinOrder<0||w.pinOrder>=WORKSPACE_LIMIT||!Number.isSafeInteger(w.createdAt)||!Number.isSafeInteger(w.updatedAt)||w.createdAt<0||w.updatedAt<w.createdAt||!w.panelState||typeof w.panelState!=='object'||Array.isArray(w.panelState))throw Error('Invalid workspace metadata.');ids.add(w.id);for(const id of Object.keys(w.layout?.panels??{})){if(!id.startsWith('chart-'))continue;if(panels.has(id))throw Error('A chart ID is shared by multiple workspaces.');panels.add(id);}if(Object.keys(w.panelState).length>5000)throw Error('Too many panel records.');for(const [key,record] of Object.entries(w.panelState))if(!panelStorageId(key)||typeof record!=='string'||record.length>4_000_000)throw Error('Invalid panel storage record.');}
  if(!ids.has(value.activeId))throw Error('Active workspace is missing.');return value;
}
export function startingLayout(chart=true):SerializedDockview {
  const id=`chart-${crypto.randomUUID()}`;return {grid:{root:{type:'branch',data:chart?[{type:'leaf',data:{views:[id],activeView:id,id:'1'},size:900}]:[],size:700},width:1200,height:700,orientation:'HORIZONTAL'},panels:chart?{[id]:{id,contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params:{venue:'binance',market:'perpetual',interval:'1m',type:'candle',studies:[]},minimumHeight:140,minimumWidth:220}}:{},...(chart?{activeGroup:'1'}:{})} as SerializedDockview;
}
export function newWorkspace(name:string,layout:SerializedDockview=startingLayout(),now=Date.now()):Workspace {return{id:`workspace-${crypto.randomUUID()}`,name:workspaceName(name),icon:'chart',pinned:false,pinOrder:0,createdAt:now,updatedAt:now,layout:validatedLayout(layout),panelState:{}};}
export function duplicateWorkspace(source:Workspace,name:string):Workspace {
  const layout=validatedLayout(source.layout),ids=new Map<string,string>();for(const id of Object.keys(layout.panels)) { const prefix=['market-comparison','depth-matrix','chart','ticker','liquidation'].find(p=>id.startsWith(p+'-')); if(prefix)ids.set(id,`${prefix}-${crypto.randomUUID()}`); }
  for(const key of Object.keys(source.panelState)){const id=panelStorageId(key);if(id&&!ids.has(id))ids.set(id,`chart-${crypto.randomUUID()}`);}
  const remap=(value:any):any=>typeof value==='string'?(ids.get(value)??value):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,remap(v)])):value;
  const next=remap(layout);next.panels=Object.fromEntries(Object.entries(layout.panels).map(([id,p])=>[ids.get(id)??id,remap(p)]));
  const copy=newWorkspace(name,next);for(const [key,value] of Object.entries(source.panelState)){const id=panelStorageId(key)!;copy.panelState[key.replace(encodeURIComponent(id),encodeURIComponent(ids.get(id)!))]=value;}return copy;
}

import type { SerializedDockview } from 'dockview-core';
import { validSeries } from './feed/protocol';
export const STORAGE_KEY='basis.layout.v1';export const PANEL_BUDGET=8;
export function restoreValue(raw:string|null):SerializedDockview|null {
  if(!raw||raw.length>100000)return null;
  try {const saved=JSON.parse(raw);if(saved.version!==1||!saved.layout||typeof saved.layout!=='object')return null;const l=saved.layout as SerializedDockview;
    if(!l.panels||typeof l.panels!=='object'||Array.isArray(l.panels)||!l.grid||Object.keys(l.panels).length>PANEL_BUDGET)return null;
    if(l.floatingGroups?.length||l.popoutGroups?.length)return null;
    for(const [id,p] of Object.entries(l.panels)){if(!/^chart-[a-z0-9-]+$/i.test(id)||p.contentComponent!=='candle'||!validSeries(p.params)||(p.params as {type?:string})?.type!=='candle')return null;}
    return l;
  }catch{return null;}
}

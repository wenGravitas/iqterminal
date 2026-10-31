import type { SerializedDockview } from 'dockview-core';
import { validSeries } from './feed/protocol';
import { depthMatrixSettings } from './feed/depth-matrix';
import { validMarketComparisonConfig } from './market-comparison/model';
export const STORAGE_KEY='basis.layout.v1';export const PANEL_BUDGET=8;
export function restoreValue(raw:string|null):SerializedDockview|null {
  if(!raw||raw.length>100000)return null;
  try {const saved=JSON.parse(raw);if(![1,2,3,4,5,6].includes(saved.version)||!saved.layout||typeof saved.layout!=='object')return null;const l=saved.layout as SerializedDockview;
    if(!l.panels||typeof l.panels!=='object'||Array.isArray(l.panels)||!l.grid||Object.keys(l.panels).length>PANEL_BUDGET+26)return null;
    if(l.floatingGroups?.length||l.popoutGroups?.length)return null;
    let charts=0, comparisons=0, editors=0, tickers=0, watches=0, depthMatrices=0, liquidations=0;
    for(const [id,p] of Object.entries(l.panels)){
      if(p.contentComponent==='candle'&&/^chart-[a-z0-9-]+$/i.test(id)&&validSeries(p.params)&&['candle','footprint'].includes((p.params as {type?:string})?.type ?? '')){charts++;continue;}
      if(saved.version>=6&&/^market-comparison-[a-z0-9-]+$/i.test(id)&&p.contentComponent==='market-comparison'&&validMarketComparisonConfig(p.params)){comparisons++;continue;}
      if(saved.version>=5&&/^liquidation-[a-z0-9-]+$/i.test(id)&&p.contentComponent==='liquidation-ticker'&&p.params&&typeof p.params==='object'){liquidations++;continue;}
      if(saved.version>=4&&/^ticker-[a-z0-9-]+$/i.test(id)&&p.contentComponent==='trade-ticker'&&p.params&&typeof p.params==='object'){tickers++;continue;}
      if(saved.version>=4&&id==='level-watch'&&p.contentComponent==='level-watch'){watches++;continue;}
      if(saved.version>=5&&/^depth-matrix-[a-z0-9-]+$/i.test(id)&&p.contentComponent==='depth-matrix'&&p.params&&typeof p.params==='object'){
        const settings=depthMatrixSettings(p.params);if(settings.sources.length<=8){depthMatrices++;continue;}
      }
      if(saved.version>=2&&id==='script-editor'&&p.contentComponent==='script-editor'){editors++;continue;}
      return null;
    }
    if(charts+comparisons>PANEL_BUDGET||editors>1||tickers>8||watches>1||depthMatrices>8||liquidations>8)return null;
    return l;
  }catch{return null;}
}

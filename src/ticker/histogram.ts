import { tradeSize, type ClassifiedTrade, type TickerConfig } from './model';
import type { ConnectionKey } from '../feed/protocol';
/** Shared linear reference for BOTH sides, independent of display filters and tier scope.
 * Scans only the existing bounded tape; no extra raw-trade retention or subscription.
 */
export function histogramScale(records:readonly ClassifiedTrade[],config:TickerConfig,now:number) {
  const start=now-config.histogramSeconds*1000;
  let maximum=0,count=0,buy=0,sell=0;
  for(const {execution:e} of records){
    if(e.timeMs<start||e.timeMs>now||e.side==='unknown'||!config.markets.includes(`${e.venue}:${e.market}` as ConnectionKey))continue;
    const size=tradeSize(e,config.displayUnit);if(!Number.isFinite(size)||size<=0)continue;
    maximum=Math.max(maximum,size);count++;if(e.side==='buy')buy+=size;else sell+=size;
  }
  return {maximum,count,buy,sell,start};
}
/** Largest print occupies 45% of the row, leaving a central gap. Older oversize rows clamp. */
export function histogramWidth(record:ClassifiedTrade,maximum:number,config:TickerConfig) {
  if(!config.histogram||record.execution.side==='unknown'||maximum<=0)return 0;
  return Math.min(1,Math.max(0,tradeSize(record.execution,config.displayUnit)/maximum))*45;
}

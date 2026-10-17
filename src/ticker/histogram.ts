import { tradeSize, type ClassifiedTrade, type TickerConfig } from './model';
import type { ConnectionKey } from '../feed/protocol';
/** Shared linear reference for both sides and independent of tier scope.
 * Recent raw prints obey the configured window; retained visible rows always participate.
 */
export function histogramScale(records:readonly ClassifiedTrade[],config:TickerConfig,now:number,visible:readonly ClassifiedTrade[] = []) {
  const start=now-config.histogramSeconds*1000;
  const visibleIds=new Set(visible.map(record=>record.execution.executionId));
  let maximum=0,count=0,buy=0,sell=0;
  for(const {execution:e} of records){
    if(((e.timeMs<start||e.timeMs>now)&&!visibleIds.has(e.executionId))||e.side==='unknown'||!config.markets.includes(`${e.venue}:${e.market}` as ConnectionKey))continue;
    const size=tradeSize(e,config.displayUnit);if(!Number.isFinite(size)||size<=0)continue;
    maximum=Math.max(maximum,size);count++;if(e.side==='buy')buy+=size;else sell+=size;
  }
  return {maximum,count,buy,sell,start};
}
/** Largest eligible print occupies 45% of the row, leaving a central gap. */
export function histogramWidth(record:ClassifiedTrade,maximum:number,config:TickerConfig) {
  if(!config.histogram||record.execution.side==='unknown'||maximum<=0)return 0;
  return Math.min(1,Math.max(0,tradeSize(record.execution,config.displayUnit)/maximum))*45;
}

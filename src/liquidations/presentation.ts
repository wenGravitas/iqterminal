import {compactSize} from '../ticker/presentation';
import type {LiquidationEvent} from './model';
import type {LiquidationBatch} from './protocol';
import type {LiquidationSettings} from './settings';
import type {Notifications} from '../notifications';
export const liquidationTime=(time:number)=>new Date(time).toISOString().slice(11,23);
export {liquidationColour}from './colors';
export function liquidationText(e:LiquidationEvent){return `${new Date(e.timeMs).toISOString()} · ${e.venue.toUpperCase()} · ${e.liquidatedSide} liquidation · forced ${e.forcedDirection} · ${e.quoteNotional===null?'Unknown':compactSize(e.quoteNotional)} USDT · ${e.reportedPriceText} (${e.priceType}) · ${e.reportingCoverage}${e.venue==='binance'?' · cumulative order snapshot; no unique order ID':''}`;}
export function burstText(b:LiquidationBatch['bursts'][number]){return `${b.side} LIQUIDATION BURST · ${compactSize(b.notional)} USDT · ${Math.max(1,Math.round((b.to-b.from)/1000))}s · ${Object.keys(b.venues).length} venue${Object.keys(b.venues).length===1?'':'s'}${b.venues.binance!==undefined?' · BN cumulative snapshots may overlap':''}`;}
export function deliverLiquidationAlerts(batch:LiquidationBatch,settings:LiquidationSettings,notifications:Notifications,owner:string){
 for(const {event,tierId}of batch.alerts){const tier=settings.tiers.find(t=>t.id===tierId);if(!tier||!tier.toast&&(tier.sound==='silent'||tier.volume<=0))continue;notifications.deliver({eventId:event.id,ruleId:`liquidation-tier:${JSON.stringify([settings.venues,settings.side,tier.minimum,tier.unit])}`,owner,timeMs:event.timeMs,fresh:true,muted:settings.muted,title:`${event.liquidatedSide} liquidation · ${tier.name}`,text:liquidationText(event),sound:tier.sound,volume:tier.volume,toast:tier.toast});}
 for(const burst of batch.burstAlerts)if(settings.burst.toast||settings.burst.sound!=='silent'&&settings.burst.volume>0)notifications.deliver({eventId:burst.id,ruleId:`liquidation-burst:${JSON.stringify([settings.venues,settings.side,settings.burst])}`,owner,timeMs:burst.to,fresh:true,muted:settings.muted,title:burstText(burst),text:[burst.venues.bybit!==undefined?'Bybit bankruptcy-price valuations':'',burst.venues.binance!==undefined?'Binance sampled cumulative snapshots may overlap':'','Reported activity · coverage gaps apply'].filter(Boolean).join(' · '),sound:settings.burst.sound,volume:settings.burst.volume,toast:settings.burst.toast});
}

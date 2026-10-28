import {expect,it,vi}from 'vitest';
import {deliverLiquidationAlerts}from '../src/liquidations/presentation';
import {liquidationSettings}from '../src/liquidations/settings';
import {NotificationGate}from '../src/notifications';
it('silent tiers without toast do not spend shared notification capacity before a burst',()=>{
 const now=Date.now(),settings=liquidationSettings({}),gate=new NotificationGate();const delivered=vi.fn((request:any)=>gate.accept(request,now,false));
 const event:any={id:'small',timeMs:now,venue:'bybit',liquidatedSide:'LONG',forcedDirection:'SELL',quoteNotional:830,reportedPriceText:'83000',priceType:'bankruptcy',reportingCoverage:'all-reported'};
 const burst:any={id:'burst',side:'LONG',from:now-100,to:now,notional:1660,venues:{bybit:1660}};
 deliverLiquidationAlerts({alerts:[{event,tierId:settings.tiers[0]!.id},{event:{...event,id:'small2'},tierId:settings.tiers[1]!.id}],burstAlerts:[burst]}as any,settings,{deliver:delivered}as any,'ticker');
 expect(delivered).toHaveBeenCalledTimes(1);expect(delivered.mock.calls[0]![0].eventId).toBe('burst');expect(gate.delivered).toBe(1);
 settings.tiers[0]!.sound='bell';settings.tiers[0]!.volume=0;deliverLiquidationAlerts({alerts:[{event,tierId:settings.tiers[0]!.id}],burstAlerts:[]}as any,settings,{deliver:delivered}as any,'ticker');expect(delivered).toHaveBeenCalledTimes(1);
 settings.burst.sound='silent';settings.burst.toast=false;deliverLiquidationAlerts({alerts:[],burstAlerts:[{...burst,id:'silent-burst'}]}as any,settings,{deliver:delivered}as any,'ticker');expect(delivered).toHaveBeenCalledTimes(1);
 settings.burst.sound='bell';settings.burst.volume=0;deliverLiquidationAlerts({alerts:[],burstAlerts:[{...burst,id:'zero-burst'}]}as any,settings,{deliver:delivered}as any,'ticker');expect(delivered).toHaveBeenCalledTimes(1);
});

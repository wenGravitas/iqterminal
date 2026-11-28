import{test,expect,vi}from'vitest';
import{CandlePanel}from'../src/panel';
import{DEFAULT_ORDER_WALLS_SETTINGS,orderWallMarket}from'../src/feed/order-walls';
const range={from:1794542850.123,to:1794652650.456};
function capture(patch:Record<string,unknown>={},settings=DEFAULT_ORDER_WALLS_SETTINGS){return CandlePanel.prototype.captureHistoryViewport.call({selection:{type:'candle',venue:'binance',...patch},nativeIndicator:()=>({visible:true,settings:{...settings,enabled:true}}),engine:{visibleTimeRange:()=>range}} as unknown as CandlePanel);}
test('ordinary wall workspace saves the latest visible viewport in milliseconds, independent of source validation',()=>{expect(capture()).toEqual({from:1794542850123,to:1794652650456});});
test('current-only, unsupported and footprint charts retain their existing capture paths',()=>{expect(capture({}, {...DEFAULT_ORDER_WALLS_SETTINGS,showHistory:false})).toBeUndefined();expect(capture({type:'footprint'})).toBeUndefined();expect(capture({venue:'hyperliquid'})).toBeUndefined();});

test('indicator visibility retains the active wall source; hiding the chart still releases it',()=>{
 const release=vi.fn(),update=vi.fn();
 const instance={visible:false,settings:{...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true}};
 const panel:any={selection:{venue:'binance',market:'perpetual'},visible:true,nativeIndicator:()=>instance,
  orderWallsControls:{sync(){},setStatus(){}},heatmapControls:{showSharedTooltip(){}},
  engine:{setOrderWalls:vi.fn(),setOrderWallSnapshot:vi.fn()},releaseOrderWalls:release,
  orderWallsSubscriptionKey:'binance:perpetual',orderWallsGeneration:1,updateOrderWallsViewport:update};
 // Use the actual source identity, independent of the display label.
 panel.orderWallsSubscriptionKey=orderWallMarket(panel.selection);
 const sync=()=> (CandlePanel.prototype as any).syncOrderWalls.call(panel);
 sync();expect(release).not.toHaveBeenCalled();expect(panel.releaseOrderWalls).toBe(release);
 instance.visible=true;sync();expect(update).toHaveBeenCalledOnce();expect(release).not.toHaveBeenCalled();
 panel.visible=false;sync();expect(release).toHaveBeenCalledOnce();expect(panel.releaseOrderWalls).toBeUndefined();
});

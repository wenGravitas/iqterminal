import{test,expect}from'vitest';
import{CandlePanel}from'../src/panel';
import{DEFAULT_ORDER_WALLS_SETTINGS}from'../src/feed/order-walls';
const range={from:1794542850.123,to:1794652650.456};
function capture(patch:Record<string,unknown>={},settings=DEFAULT_ORDER_WALLS_SETTINGS){return CandlePanel.prototype.captureHistoryViewport.call({selection:{type:'candle',venue:'binance',...patch},nativeIndicator:()=>({visible:true,settings:{...settings,enabled:true}}),engine:{visibleTimeRange:()=>range}} as unknown as CandlePanel);}
test('ordinary wall workspace saves the latest visible viewport in milliseconds, independent of source validation',()=>{expect(capture()).toEqual({from:1794542850123,to:1794652650456});});
test('current-only, unsupported and footprint charts retain their existing capture paths',()=>{expect(capture({}, {...DEFAULT_ORDER_WALLS_SETTINGS,showHistory:false})).toBeUndefined();expect(capture({type:'footprint'})).toBeUndefined();expect(capture({venue:'hyperliquid'})).toBeUndefined();});

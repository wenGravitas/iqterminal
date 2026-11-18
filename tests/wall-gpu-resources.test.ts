import {expect,test} from 'vitest';
import {PriceScale,type PrimitiveRenderContext} from 'openalgo-charts';
import {splitWallCoordinate,wallStrengthTier,wallTierCuts,wallPriceCamera} from '../src/chart/wall-gpu-resources';
const f=Math.fround;
function shaderDifference(a:number,b:number){const x=splitWallCoordinate(a),y=splitWallCoordinate(b);return f(f(x[0]-y[0])+f(x[1]-y[1]));}
test('split relative coordinates preserve fractional slots and native price ticks at deep zoom',()=>{
 for(const [value,origin,scale]of [[8191.99998,8191.99999,50000],[119.0000001,119,100000],[1234.01,1234.0099,100000],[-1000.01,-1000.01001,100000]]){
  expect(Math.abs(shaderDifference(value!,origin!)*scale!-(value!-origin!)*scale!)).toBeLessThan(.001);
 }
 const base=65000,p=65000.01,top=65000.02;
 expect(Math.abs(shaderDifference(Math.log10(p/base),Math.log10(top/base))*1e8-(Math.log10(p/base)-Math.log10(top/base))*1e8)).toBeLessThan(.001);
});
test.each([true,false])('rank cutoffs exactly reproduce CPU contrast tiers without Float32 notional rounding: %s',highContrast=>{
 const min=1e12,max=min+10,values=[min,min+.0001,min+2.4999,min+2.5,min+2.5001,min+5.4999,min+5.5,min+5.5001,min+8.4999,min+8.5,min+8.5001,max];
 const style={min,max,highContrast},cuts=wallTierCuts(values,style);
 for(let rank=0;rank<values.length;rank++){const tier=rank<cuts[0]?0:rank<cuts[1]?1:rank<cuts[2]?2:3;expect(tier).toBe(wallStrengthTier(values[rank]!,style));}
});
test('equal and empty notional ranges retain incumbent style behavior',()=>{
 expect(wallTierCuts([42],{min:42,max:42,highContrast:true})).toEqual([0,1,1]);
 expect(wallTierCuts([],{min:0,max:0,highContrast:true})).toEqual([0,0,0]);
 expect(wallStrengthTier(0,{min:0,max:0,highContrast:true})).toBe(0);
});


test.each(['linear','logarithmic','percentage','indexed-to-100'] as const)('GPU price coordinates match actual OpenAlgo %s scale at .01 tick precision',mode=>{
 for(const inverted of [false,true])for(const dpr of [1,2]){
  const scale=new PriceScale({mode,inverted});scale.setHeight(600);scale.setBaseline(65010);scale.setPriceRange({min:64999.9,max:65000.3});
  const base=65000,rc={priceScale:scale,dpr} as PrimitiveRenderContext,camera=wallPriceCamera(rc,base)!;
  for(let i=0;i<20;i++){const price=base+i*.01,coordinate=camera.log?Math.log10(price/base):price-base,origin=camera.priceOrigin[0]+camera.priceOrigin[1];
   const actual=f(shaderDifference(coordinate,origin)*f(camera.priceScale));expect(Math.abs(actual-scale.priceToY(price)*dpr)).toBeLessThan(.001);
  }
 }
});

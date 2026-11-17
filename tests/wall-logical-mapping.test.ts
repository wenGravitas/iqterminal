import {expect,test} from 'vitest';
import type {PrimitiveRenderContext} from 'openalgo-charts';
import {WallLogicalMapping} from '../src/chart/wall-logical-mapping';
const base=1700000000;
function context(times:number[],pan=0,scale=20,prepend=0):PrimitiveRenderContext{
 const at=(index:number)=>times[index-prepend];
 return {dataLayer:{indexToTimeFloat:at,timeToIndexFloat:(time:number)=>{
  for(let i=0;i<times.length-1;i++)if(time>=times[i]!&&time<=times[i+1]!)return prepend+i+(time-times[i]!)/(times[i+1]!-times[i]!);
  return NaN;
 }},timeScale:{indexToX:(index:number)=>(index-pan)*scale}} as any;
}
test('retained knots preserve fractional positions across camera movement and prepend',()=>{
 const times=[base,base+60,base+600,base+660],mapping=WallLogicalMapping.capture(context(times),base*1000,(base+660)*1000)!;
 expect(mapping.logical((base+330)*1000)).toBe(1.5);
 for(const [pan,scale,prepend] of [[0,20,0],[1.2,35,0],[-20,3,4],[4,200,4]]){
  const rc=context(times,pan,scale,prepend),camera=mapping.camera(rc)!;
  expect(camera.x+camera.scale*mapping.logical((base+330)*1000)!).toBeCloseTo(rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(base+330)),10);
 }
 expect(mapping.bytes).toBe(32);
});
test('unchanged interval endpoints cannot hide an inserted or corrected candle knot',()=>{
 const times=[base,base+60,base+600,base+660],mapping=WallLogicalMapping.capture(context(times),base*1000,(base+660)*1000)!;
 expect(mapping.camera(context([base,base+120,base+600,base+660]))).toBeUndefined();
 expect(mapping.camera(context([base,base+60,base+300,base+600,base+660]))).toBeUndefined();
 expect(mapping.camera(context(times))).toBeDefined();
});
test('mapping allocation and extrapolation are explicitly bounded',()=>{
 const rc=context([base,base+60,base+600,base+660]);
 expect(WallLogicalMapping.capture(rc,base*1000,(base+660)*1000,3)).toBeUndefined();
 const mapping=WallLogicalMapping.capture(rc,(base+30)*1000,(base+630)*1000)!;
 expect(mapping.logical((base+20)*1000)).toBeUndefined();
 expect(mapping.logical((base+640)*1000)).toBeUndefined();
 expect(WallLogicalMapping.capture(rc,NaN,1)).toBeUndefined();
});

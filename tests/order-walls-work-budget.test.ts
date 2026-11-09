import {afterEach,expect,test,vi} from 'vitest';
import type {PrimitiveRenderContext} from 'openalgo-charts';
import {OrderWallsPrimitive} from '../src/chart/order-walls';
import {DEFAULT_ORDER_WALLS_SETTINGS,type OrderWallSegment} from '../src/feed/order-walls';
const base=1704067200000;
const settings={...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,mode:'top-levels' as const,aggregation:'native' as const};
const status={state:'live' as const,tickSize:.1,lastConfirmedAt:base+120000};
class Paths {
 commands:Array<[string,number,number]>=[];
 moveTo(x:number,y:number){this.commands.push(['M',x,y]);}
 lineTo(x:number,y:number){this.commands.push(['L',x,y]);}
 addPath(path:Paths){this.commands.push(...path.commands);}
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function setup(){vi.stubGlobal('Path2D',Paths);let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>++clock);}
function source(){return Array.from({length:20},(_,i):OrderWallSegment=>({id:'wall-'+i,archiveEntryId:'entry-'+i,epoch:1,side:i%2?'ask':'bid',price:100+i*.1,start:base,end:base+120000,peakUsd:1000,meanUsd:500,durationMs:120000,percentile:null,scopePartial:false,startKnown:true,endKnown:true,endReason:'rank-exit',detectionMode:'top-levels',rank:1,valueRunsTruncated:false,valueRuns:Array.from({length:8},(_,j)=>({at:base+j*10000,usd:100+i*10+j*20,quantity:1,rank:1,percentile:null}))}));}
function context(from=0,dpr=1):PrimitiveRenderContext{return {timeScale:{visibleRange:()=>({from,to:from+2}),indexToX:(i:number)=>(i-from)*200,xToIndex:(x:number)=>x/200+from},priceScale:{priceRange:()=>({min:90,max:120}),priceToY:(p:number)=>(120-p)*10},dataLayer:{indexToTimeFloat:(i:number)=>base/1000+i*60,timeToIndexFloat:(t:number)=>(t-base/1000)/60},plotWidth:400,plotHeight:300,dpr,theme:{background:'#000',axisText:'#aaa'}} as any;}
function canvas(){const strokes:any[]=[];const ctx:any={save(){},restore(){},beginPath(){},rect(){},clip(){},setLineDash(){},stroke(path:Paths){strokes.push({color:ctx.strokeStyle,width:ctx.lineWidth,commands:[...path.commands]});}};return {ctx:ctx as CanvasRenderingContext2D,strokes};}
function complete(p:OrderWallsPrimitive,rc=context()){
 let frame=canvas();for(let i=0;i<2000;i++){frame=canvas();p.draw(frame.ctx,rc);const d=p.diagnostics();if(!d.pendingPaintWork&&!d.pendingProjectionSegments&&!d.pendingReferenceSegments&&d.inputRevision===d.paintedRevision)return frame;}
 throw Error('Bounded preparation did not settle');
}
function attached(){const p=new OrderWallsPrimitive(settings,60000,true,1),requestUpdate=vi.fn();p.attached({requestUpdate});return {p,requestUpdate};}
function shape(p:OrderWallsPrimitive){return [...(p as any).drawable.values()].map(({segment,paintOrder,...line}:any)=>({id:segment.id,...line})).sort((a,b)=>a.key.localeCompare(b.key));}
test('bounded RAF passes preserve exact completed geometry, styles and source while never certifying a partial pass',()=>{
 setup();const walls=source(),before=JSON.stringify(walls),{p,requestUpdate}=attached(),baseline=new OrderWallsPrimitive(settings,60000,true,0);p.setSnapshot(walls,status);baseline.setSnapshot(walls,status);
 const first=canvas();p.draw(first.ctx,context());expect(p.diagnostics().pendingPaintWork).toBe(true);expect(p.diagnostics().paintedRevision).not.toBe(p.diagnostics().inputRevision);expect(p.diagnostics().preparation.steps).toBeLessThanOrEqual(32);expect(requestUpdate).toHaveBeenCalled();
 const painted=complete(p),reference=complete(baseline);expect(shape(p)).toEqual(shape(baseline));expect(painted.strokes).toEqual(reference.strokes);expect(JSON.stringify(walls)).toBe(before);expect(p.diagnostics().preparation.slices).toBeGreaterThan(1);
});
test('removal and replacement during a pass cannot resurrect a deleted wall or acknowledge the old revision',()=>{
 setup();const walls=source(),{p}=attached(),baseline=new OrderWallsPrimitive(settings,60000,true,0);p.setSnapshot(walls,status);baseline.setSnapshot(walls,status);complete(baseline);
 p.draw(canvas().ctx,context());const revised={...walls[2]!,price:103,valueRuns:walls[2]!.valueRuns.map(point=>({...point,usd:point.usd!*2}))};
 const patches=[{id:walls[0]!.id,segment:null},{id:revised.id,segment:revised,replaceValueRuns:true}];p.patch(patches,status);baseline.patch(patches,status);
 const painted=complete(p),reference=complete(baseline);expect(shape(p)).toEqual(shape(baseline));expect((p as any).segments.has(walls[0]!.id)).toBe(false);expect(shape(p).some(line=>line.id===walls[0]!.id)).toBe(false);expect(painted.strokes).toEqual(reference.strokes);
});
test.each([true,false])('pan/DPR/style cancellation revalidates the complete reference, visibleOnly=%s',visibleRangeOnly=>{
 setup();const config={...settings,visibleRangeOnly},p=new OrderWallsPrimitive(config,60000,true,1),baseline=new OrderWallsPrimitive(config,60000,true,0);p.attached({requestUpdate:vi.fn()});const walls=source();p.setSnapshot(walls,status);baseline.setSnapshot(walls,status);
 for(let i=0;i<7;i++)p.draw(canvas().ctx,context());
 const next={...config,colorMode:'bid-ask' as const};p.setSettings(next);baseline.setSettings(next);
 const rc=context(.25,2),painted=complete(p,rc),reference=complete(baseline,rc);expect(shape(p)).toEqual(shape(baseline));expect(painted.strokes).toEqual(reference.strokes);expect(p.diagnostics().referenceMinimum).toBe(baseline.diagnostics().referenceMinimum);expect(p.diagnostics().referenceMaximum).toBe(baseline.diagnostics().referenceMaximum);expect(p.diagnostics().preparation.cancelled).toBeGreaterThan(0);
});
test('an append during initial geometry retains every point and eventually paints the new tail',()=>{
 setup();const walls=source();walls[0]={...walls[0]!,end:null,currentSelection:true,endKnown:false,endReason:null};const {p}=attached(),baseline=new OrderWallsPrimitive(settings,60000,true,0);p.setSnapshot(walls,status);baseline.setSnapshot(walls,status);complete(baseline);p.draw(canvas().ctx,context());
 const point={at:base+100000,usd:9000,quantity:2,rank:1,percentile:null},next={...walls[0]!,valueRuns:[...walls[0]!.valueRuns,point]},patch={id:next.id,segment:next,valuePoints:[point]};p.patch([patch],status);baseline.patch([patch],status);
 const painted=complete(p),reference=complete(baseline);expect(shape(p)).toEqual(shape(baseline));expect(painted.strokes).toEqual(reference.strokes);expect((p as any).segments.get(next.id).valueRuns).toHaveLength(9);
});
test('detach cancels all retained work and empty replacement cannot retain pending geometry',()=>{
 setup();const {p}=attached();p.setSnapshot(source(),status);p.draw(canvas().ctx,context());expect(p.diagnostics().pendingPaintWork).toBe(true);p.detached();expect(p.diagnostics()).toMatchObject({pendingPaintWork:false,pendingProjectionSegments:0,pendingReferenceSegments:0,retainedSegments:0,retainedDrawables:0});expect((p as any).drawWork).toBeUndefined();
 p.setSnapshot(source(),status);p.attached({requestUpdate:vi.fn()});p.draw(canvas().ctx,context());p.setSnapshot([],status);expect(p.diagnostics()).toMatchObject({pendingPaintWork:false,retainedSegments:0,pendingProjectionSegments:0});
});

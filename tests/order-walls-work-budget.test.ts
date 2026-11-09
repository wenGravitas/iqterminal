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
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
function setup(){vi.stubGlobal('Path2D',Paths);let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>++clock);}
function source(){return Array.from({length:20},(_,i):OrderWallSegment=>({id:'wall-'+i,archiveEntryId:'entry-'+i,epoch:1,side:i%2?'ask':'bid',price:100+i*.1,start:base,end:base+120000,peakUsd:1000,meanUsd:500,durationMs:120000,percentile:null,scopePartial:false,startKnown:true,endKnown:true,endReason:'rank-exit',detectionMode:'top-levels',rank:1,valueRunsTruncated:false,valueRuns:Array.from({length:8},(_,j)=>({at:base+j*10000,usd:100+i*10+j*20,quantity:1,rank:1,percentile:null}))}));}
function context(from=0,dpr=1):PrimitiveRenderContext{return {timeScale:{visibleRange:()=>({from,to:from+2}),indexToX:(i:number)=>(i-from)*200,xToIndex:(x:number)=>x/200+from},priceScale:{priceRange:()=>({min:90,max:120}),priceToY:(p:number)=>(120-p)*10},dataLayer:{indexToTimeFloat:(i:number)=>base/1000+i*60,timeToIndexFloat:(t:number)=>(t-base/1000)/60},plotWidth:400,plotHeight:300,dpr,theme:{background:'#000',axisText:'#aaa'}} as any;}
function canvas(){const strokes:any[]=[];const ctx:any={save(){},restore(){},beginPath(){},rect(){},clip(){},setLineDash(){},stroke(path:Paths){strokes.push({color:ctx.strokeStyle,width:ctx.lineWidth,commands:[...path.commands]});}};return {ctx:ctx as CanvasRenderingContext2D,strokes};}
function complete(p:OrderWallsPrimitive,rc=context()){
 let frame=canvas();for(let i=0;i<2000;i++){frame=canvas();p.draw(frame.ctx,rc);const d=p.diagnostics();if(!d.pendingPaintWork&&!d.pendingProjectionSegments&&!d.pendingReferenceSegments&&d.inputRevision===d.paintedRevision)return frame;}
 throw Error('Bounded preparation did not settle');
}
function attached(background=false){const p=new OrderWallsPrimitive(settings,60000,true,1,()=>true,background),requestUpdate=vi.fn();p.attached({requestUpdate});return {p,requestUpdate};}
function shape(p:OrderWallsPrimitive){return [...(p as any).drawable.values()].map(({segment,paintOrder,...line}:any)=>({id:segment.id,...line})).sort((a,b)=>a.key.localeCompare(b.key));}
test('bounded RAF passes preserve exact completed geometry, styles and source while never certifying a partial pass',()=>{
 setup();const walls=source(),before=JSON.stringify(walls),{p,requestUpdate}=attached(),baseline=new OrderWallsPrimitive(settings,60000,true,0);p.setSnapshot(walls,status);baseline.setSnapshot(walls,status);
 const first=canvas();p.draw(first.ctx,context());expect(p.diagnostics().pendingPaintWork).toBe(true);expect(p.diagnostics().paintedRevision).not.toBe(p.diagnostics().inputRevision);expect(p.diagnostics().preparation.steps).toBeLessThanOrEqual(32);expect(requestUpdate).toHaveBeenCalled();
 const painted=complete(p),reference=complete(baseline);expect(shape(p)).toEqual(shape(baseline));expect(painted.strokes).toEqual(reference.strokes);expect(JSON.stringify(walls)).toBe(before);expect(p.diagnostics().preparation.slices).toBeGreaterThan(1);const hits=p.diagnostics().paintCacheHits;p.draw(canvas().ctx,context());expect(p.diagnostics().paintCacheHits).toBeGreaterThan(hits);
});
test('removal and replacement before first completed paint cannot resurrect a deleted wall or acknowledge the old revision',()=>{
 setup();const walls=source(),{p}=attached(),baseline=new OrderWallsPrimitive(settings,60000,true,0);p.setSnapshot(walls,status);baseline.setSnapshot(walls,status);
 // Neither renderer has completed its first paint when these inputs arrive.
 p.draw(canvas().ctx,context());const revised={...walls[2]!,price:103,valueRuns:walls[2]!.valueRuns.map(point=>({...point,usd:point.usd!*2}))};
 const patches=[{id:walls[0]!.id,segment:null},{id:revised.id,segment:revised,replaceValueRuns:true}];p.patch(patches,status);baseline.patch(patches,status);
 const painted=complete(p),reference=complete(baseline);expect(shape(p)).toEqual(shape(baseline));expect((p as any).segments.has(walls[0]!.id)).toBe(false);expect(shape(p).some(line=>line.id===walls[0]!.id)).toBe(false);expect(painted.strokes).toEqual(reference.strokes);
});
test.each([true,false])('pan/DPR/style cancellation revalidates the complete reference, visibleOnly=%s',visibleRangeOnly=>{
 setup();const config={...settings,visibleRangeOnly},p=new OrderWallsPrimitive(config,60000,true,1,()=>true,false),baseline=new OrderWallsPrimitive(config,60000,true,0);p.attached({requestUpdate:vi.fn()});const walls=source();p.setSnapshot(walls,status);baseline.setSnapshot(walls,status);
 let referenceStarted=false;for(let i=0;i<200;i++){p.draw(canvas().ctx,context());if(p.diagnostics().preparation.phase==='reference'){referenceStarted=true;break;}}expect(referenceStarted).toBe(true);
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

test('removal during first native path compilation cannot leave a ghost in the next certified cache',()=>{
 setup();const walls=source().map(s=>({...s,valueRuns:Array.from({length:64},(_,j)=>({...s.valueRuns[0]!,at:base+j*1800,usd:s.valueRuns[0]!.usd!+j}))})),{p}=attached(),baseline=new OrderWallsPrimitive(settings,60000,true,0);p.setSnapshot(walls,status);baseline.setSnapshot(walls,status);complete(baseline);
 let found=false;for(let i=0;i<1000;i++){p.draw(canvas().ctx,context());if(p.diagnostics().preparation.phase==='paint'&&p.diagnostics().pendingPaintWork){found=true;break;}}
 expect(found).toBe(true);for(let i=0;i<6;i++)p.draw(canvas().ctx,context());expect(p.diagnostics().pendingPaintWork).toBe(true);
 const patch={id:walls[2]!.id,segment:null};p.patch([patch],status);baseline.patch([patch],status);
 const painted=complete(p),reference=complete(baseline);expect(shape(p)).toEqual(shape(baseline));expect(painted.strokes).toEqual(reference.strokes);
});

test('background slices prepare without scheduling a chart frame per slice and still wait for an actual paint',()=>{
 setup();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});vi.stubGlobal('window',{});
 const {p,requestUpdate}=attached(true);p.setSnapshot(source(),status);const before=requestUpdate.mock.calls.length;p.draw(canvas().ctx,context());
 expect(vi.getTimerCount()).toBe(1);expect(requestUpdate).toHaveBeenCalledTimes(before);
 vi.runAllTimers();expect(p.diagnostics().preparation.slices).toBeGreaterThan(1);expect(vi.getTimerCount()).toBe(0);
 expect(p.diagnostics().pendingPaintWork).toBe(true);expect(p.diagnostics().paintedRevision).not.toBe(p.diagnostics().inputRevision);expect(requestUpdate).toHaveBeenCalledTimes(before+1);
 p.draw(canvas().ctx,context());expect(p.diagnostics().paintedRevision).toBe(p.diagnostics().inputRevision);expect(p.diagnostics().pendingPaintWork).toBe(false);p.detached();
});
test('hidden work pauses without a timer loop and detach cancels a queued background slice',()=>{
 setup();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});vi.stubGlobal('window',{});let visible=true;
 const p=new OrderWallsPrimitive(settings,60000,true,1,()=>visible);p.attached({requestUpdate:vi.fn()});p.setSnapshot(source(),status);p.draw(canvas().ctx,context());const slices=p.diagnostics().preparation.slices;
 visible=false;vi.runAllTimers();expect(p.diagnostics().preparation.slices).toBe(slices);expect(vi.getTimerCount()).toBe(0);expect(p.diagnostics().pendingPaintWork).toBe(true);
 visible=true;p.draw(canvas().ctx,context());expect(vi.getTimerCount()).toBe(1);p.detached();expect(vi.getTimerCount()).toBe(0);expect(p.diagnostics().pendingPaintWork).toBe(false);
});

test('background work cancels a changed transform before advancing obsolete geometry',()=>{
 setup();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const {p,requestUpdate}=attached(true);const rc=context();let from=0;
 (rc.timeScale as any).visibleRange=()=>({from,to:from+2});(rc.timeScale as any).indexToX=(i:number)=>(i-from)*200;
 p.setSnapshot(source(),status);p.draw(canvas().ctx,rc);const before=p.diagnostics().preparation.slices;from=.25;
 vi.runOnlyPendingTimers();expect(p.diagnostics().preparation.slices).toBe(before);expect(p.diagnostics().preparation.cancelled).toBe(1);expect(vi.getTimerCount()).toBe(0);expect(requestUpdate).toHaveBeenCalled();expect(p.orderWallAt(100,100)).toBeNull();
 p.draw(canvas().ctx,rc);vi.runAllTimers();const painted=complete(p,rc),baseline=new OrderWallsPrimitive(settings,60000,true,0);baseline.setSnapshot(source(),status);const reference=complete(baseline,rc);expect(shape(p)).toEqual(shape(baseline));expect(painted.strokes).toEqual(reference.strokes);p.detached();
});
test('replacement during reference traversal cannot commit stale extrema or double-decrement shared counts',()=>{
 setup();const walls=source().map(s=>({...s,valueRuns:Array.from({length:64},(_,j)=>({...s.valueRuns[0]!,at:base+j*1800,usd:s.valueRuns[0]!.usd!+j}))})),{p}=attached();p.setSnapshot(walls,status);
 let found=false;for(let i=0;i<1000;i++){p.draw(canvas().ctx,context());if(p.diagnostics().preparation.phase==='reference'){found=true;break;}}expect(found).toBe(true);
 const revised={...walls[0]!,valueRuns:walls[0]!.valueRuns.map(point=>({...point,usd:point.usd!*100}))};p.patch([{id:revised.id,segment:revised,replaceValueRuns:true}],status);complete(p);
 const baseline=new OrderWallsPrimitive(settings,60000,true,0);baseline.setSnapshot([revised,...walls.slice(1)],status);complete(baseline);
 expect(shape(p)).toEqual(shape(baseline));expect(p.diagnostics().referenceMinimum).toBe(baseline.diagnostics().referenceMinimum);expect(p.diagnostics().referenceMaximum).toBe(baseline.diagnostics().referenceMaximum);
 const styles=(value:any)=>[...value.drawable.values()].map((line:any)=>[line.key,value.lineStyle(line)]).sort((a,b)=>a[0].localeCompare(b[0]));expect(styles(p)).toEqual(styles(baseline));
});

test('projection evaluates price once per segment and skips time conversion for offscreen value histories',()=>{
 setup();const walls=source().map((wall,i)=>({...wall,price:i<10?wall.price:500+i})),before=JSON.stringify(walls),rc=context();
 const price=vi.spyOn(rc.priceScale,'priceToY'),time=vi.spyOn(rc.dataLayer,'timeToIndexFloat');
 const p=new OrderWallsPrimitive(settings,60000,true,0);p.setSnapshot(walls,status);p.draw(canvas().ctx,rc);
 expect(price).toHaveBeenCalledTimes(walls.length);
 expect(time).toHaveBeenCalledTimes(10*8*2);
 expect(p.diagnostics()).toMatchObject({retainedSegments:20,retainedDrawables:80});
 expect(JSON.stringify(walls)).toBe(before);p.detached();
});

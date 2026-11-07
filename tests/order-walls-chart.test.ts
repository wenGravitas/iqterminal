import { describe, expect, it,vi } from 'vitest';
import type { PrimitiveRenderContext } from 'openalgo-charts';
import { DEFAULT_ORDER_WALLS_SETTINGS, resolveAutoOrderWallPriceWidth, type OrderWallSegment } from '../src/feed/order-walls';
import { OrderWallsPrimitive, orderWallsFitRange } from '../src/chart/order-walls';

const LEGACY_ORDER_WALLS_SETTINGS={...DEFAULT_ORDER_WALLS_SETTINGS,mode:'threshold' as const,aggregation:'auto' as const,thicknessPx:2};
const base = 1_704_067_200_000;

function context({ from = 0, to = 2, xPerIndex = 100, dpr = 2 }: { from?: number; to?: number; xPerIndex?: number; dpr?: number } = {}): PrimitiveRenderContext {
  const timeScale = {
    visibleRange: () => ({ from, to }),
    indexToX: (index: number) => 50 + (index - from) * xPerIndex,
    xToIndex: (x: number) => from + (x - 50) / xPerIndex,
  };
  const priceScale = {
    priceRange: () => ({ min: 90, max: 120 }),
    priceToY: () => 100,
  };
  const dataLayer = {
    length: 3, baseIndex: 2,
    indexToTime: (index: number) => base / 1000 + index * 60,
    indexToTimeFloat: (index: number) => base / 1000 + index * 60,
    timeToIndexFloat: (seconds: number) => (seconds - base / 1000) / 60,
  };
  return { timeScale, priceScale, dataLayer, plotWidth: 500, plotHeight: 300, dpr } as unknown as PrimitiveRenderContext;
}

interface CapturedPath { color: string; points: Array<[number, number]> }
function canvas(styles: string[] = [], paths: CapturedPath[] = []): CanvasRenderingContext2D {
  let points: Array<[number, number]> = [];
  const value: Record<string, any> = { save() {}, beginPath() { points = []; }, rect() {}, clip() {}, setLineDash() {},
    moveTo(x: number, y: number) { points.push([x, y]); }, lineTo(x: number, y: number) { points.push([x, y]); },
    stroke() { styles.push(value.strokeStyle); paths.push({ color: value.strokeStyle, points: [...points] }); }, restore() {} };
  return value as unknown as CanvasRenderingContext2D;
}

describe('Order Walls chart hit testing', () => {
  it('does not certify a new input/status revision as painted until a completed draw',()=>{
    const primitive=new OrderWallsPrimitive({...LEGACY_ORDER_WALLS_SETTINGS,enabled:true},60_000),status={state:'live' as const,lastConfirmedAt:base+120_000};
    const segment:OrderWallSegment={id:'paint-version',epoch:1,side:'bid',price:100,start:base,end:base+120_000,peakUsd:10000,meanUsd:10000,durationMs:120000,percentile:99,scopePartial:false,startKnown:true,valueRuns:[],valueRunsTruncated:false,endReason:'removed',endKnown:true};
    primitive.setSnapshot([segment],status);expect(primitive.diagnostics().paintedRevision).not.toBe(primitive.diagnostics().inputRevision);
    primitive.draw(canvas(),context());expect(primitive.diagnostics().paintedRevision).toBe(primitive.diagnostics().inputRevision);expect(primitive.diagnostics().pendingProjectionSegments).toBe(0);
    primitive.setStatus({...status,message:'Final source validation complete'});expect(primitive.diagnostics().paintedRevision).not.toBe(primitive.diagnostics().inputRevision);
    primitive.draw(canvas(),context());expect(primitive.diagnostics().paintedRevision).toBe(primitive.diagnostics().inputRevision);
    primitive.patch([{id:segment.id,segment:{...segment,peakUsd:20000}}],status);expect(primitive.diagnostics().paintedRevision).not.toBe(primitive.diagnostics().inputRevision);
  });
  it('maps CSS pointer x to the same event time at DPR 2 used by projected geometry', () => {
    const primitive = new OrderWallsPrimitive({ ...LEGACY_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const segment: OrderWallSegment = {
      id: 'wall', epoch: 1, side: 'bid', price: 100, start: base, end: base + 120_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 120_000, percentile: 99,
      scopePartial: false, startKnown: true, valueRuns: [], valueRunsTruncated: false,
      endReason: 'removed', endKnown: true,
    };
    primitive.setSnapshot([segment], { state: 'live', lastConfirmedAt: base + 120_000 });
    const paths: CapturedPath[] = [];
    primitive.draw(canvas([], paths), context());

    // x=150 CSS px is logical index 1. Multiplying it by DPR would select 2.5.
    const hit = primitive.orderWallAt(150, 100);
    expect(hit?.at).toBe(base + 60_000);
    expect(paths).toEqual([{ color: '#37c4d2', points: [[100, 200], [500, 200]] }]);
  });

  it('keeps each historical wall span in the colour of its contemporaneous percentile', () => {
    const primitive = new OrderWallsPrimitive({ ...LEGACY_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const segment: OrderWallSegment = {
      id: 'wall', epoch: 1, side: 'bid', price: 100, start: base, end: base + 120_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 120_000, percentile: 100,
      scopePartial: false, startKnown: true,
      valueRuns: [
        { at: base, usd: 10_000, percentile: 50 },
        { at: base + 60_000, usd: 10_000, percentile: 100 },
      ], valueRunsTruncated: false, endReason: 'removed', endKnown: true,
    };
    primitive.setSnapshot([segment], { state: 'live', lastConfirmedAt: base + 120_000, resolvedPriceWidth: 50 });
    const styles: string[] = [];
    primitive.draw(canvas(styles), context());

    expect(styles).toEqual(['#37c4d2', '#ff884d']);
    expect(primitive.orderWallAt(100, 100)).toMatchObject({ at: base + 30_000, percentile: 50, priceHigh: 150 });
    expect(primitive.orderWallAt(200, 100)).toMatchObject({ at: base + 90_000, percentile: 100, priceHigh: 150 });
  });

  it('coalesces contiguous same-colour runs while retaining per-run time hover and subpixel union', () => {
    const primitive = new OrderWallsPrimitive({ ...LEGACY_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const segment: OrderWallSegment = {
      id: 'wall-runs', epoch: 1, side: 'bid', price: 100, start: base, end: base + 300,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 300, percentile: 99,
      scopePartial: false, startKnown: true,
      valueRuns: [
        { at: base, usd: 10_000, percentile: 98.1 },
        { at: base + 100, usd: 10_000, percentile: 98.5 },
        { at: base + 200, usd: 10_000, percentile: 98.9 },
      ], valueRunsTruncated: false, endReason: 'removed', endKnown: true,
    };
    primitive.setSnapshot([segment], { state: 'live', lastConfirmedAt: base + 300 });
    const styles: string[] = [], paths: CapturedPath[] = [];
    primitive.draw(canvas(styles, paths), context());

    // The three minimum-one-pixel spans overlap in CSS space, but share one
    // source interval chain and style. The path is their union, not a darkened
    // stack of three alpha strokes.
    expect(styles).toEqual(['#37c4d2']);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.color).toBe('#37c4d2');
    expect(paths[0]?.points[0]).toEqual([100, 200]);
    expect(paths[0]?.points[1]?.[0]).toBeCloseTo(102.6667, 3);
    expect(paths[0]?.points[1]?.[1]).toBe(200);
    expect(primitive.orderWallAt(50.2, 100)).toMatchObject({ at: base + 120, percentile: 98.5 });
  });

  it('keeps mixed percentile color boundaries as separate strokes', () => {
    const primitive = new OrderWallsPrimitive({ ...LEGACY_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const segment: OrderWallSegment = {
      id: 'wall-color-groups', epoch: 1, side: 'bid', price: 100, start: base, end: base + 120_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 120_000, percentile: 100,
      scopePartial: false, startKnown: true,
      valueRuns: [
        { at: base, usd: 10_000, percentile: 98.1 },
        { at: base + 20_000, usd: 10_000, percentile: 98.5 },
        { at: base + 40_000, usd: 10_000, percentile: 99.1 },
        { at: base + 60_000, usd: 10_000, percentile: 99.8 },
        { at: base + 80_000, usd: 10_000, percentile: 99.95 },
        { at: base + 100_000, usd: 10_000, percentile: 100 },
      ], valueRunsTruncated: false, endReason: 'removed', endKnown: true,
    };
    primitive.setSnapshot([segment], { state: 'live', lastConfirmedAt: base + 120_000 });
    const styles: string[] = [], paths: CapturedPath[] = [];
    primitive.draw(canvas(styles, paths), context());

    expect(styles).toEqual(['#37c4d2', '#f1cb59', '#ff884d']);
    expect(paths.map(path => path.points.map(point => point.map(value => Number(value.toFixed(3)))))).toEqual([
      [[100, 200], [233.333, 200]],
      [[233.333, 200], [366.667, 200]],
      [[366.667, 200], [500, 200]],
    ]);
  });

  it('keeps separate wall episodes apart across time gaps even with the same color', () => {
    const primitive = new OrderWallsPrimitive({ ...LEGACY_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const segment = (id: string, start: number): OrderWallSegment => ({
      id, epoch: 1, side: 'bid', price: 100, start, end: start + 60_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 60_000, percentile: 98.5,
      scopePartial: false, startKnown: true,
      valueRuns: [{ at: start, usd: 10_000, percentile: 98.5 }], valueRunsTruncated: false,
      endReason: 'removed', endKnown: true,
    });
    primitive.setSnapshot([segment('first-episode', base), segment('later-episode', base + 180_000)], {
      state: 'live', lastConfirmedAt: base + 240_000,
    });
    const styles: string[] = [], paths: CapturedPath[] = [];
    primitive.draw(canvas(styles, paths), context({ to: 5 }));

    expect(styles).toEqual(['#37c4d2', '#37c4d2']);
    expect(paths).toEqual([
      { color: '#37c4d2', points: [[100, 200], [300, 200]] },
      { color: '#37c4d2', points: [[700, 200], [900, 200]] },
    ]);
  });

  it('keeps durable archive history outside the direct-history episode setting', () => {
    const primitive = new OrderWallsPrimitive({ ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true, historyEpisodes: 16 }, 60_000);
    const archived = (index: number, archive = true): OrderWallSegment => ({
      id: `${archive ? 'archive' : 'direct'}-${index}`, ...(archive ? { archiveEntryId: `candidate-${index}` } : {}),
      epoch: 1, side: 'bid', price: 100, start: base + index * 1_000, end: base + index * 1_000 + 500,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 500, percentile: null,
      scopePartial: true, startKnown: true, detectionMode: 'top-levels', rank: 1,
      valueRuns: [], valueRunsTruncated: false, endReason: 'rank-exit', endKnown: true,
    });
    const walls = Array.from({ length: 2_100 }, (_, index) => archived(index));
    primitive.setSnapshot(walls, { state: 'live', lastConfirmedAt: base + 2_100_000 });
    expect(primitive.diagnostics().retainedSegments).toBe(2_100);

    primitive.setSnapshot(Array.from({ length: 20 }, (_, index) => archived(index, false)), {
      state: 'live', lastConfirmedAt: base + 2_100_000,
    });
    expect(primitive.diagnostics().retainedSegments).toBe(16);
  });

  it('projects only visible archive value runs while keeping raw exact values available for hover', () => {
    const primitive = new OrderWallsPrimitive({ ...DEFAULT_ORDER_WALLS_SETTINGS, enabled: true }, 60_000);
    const valueRuns = Array.from({ length: 100_000 }, (_, index) => ({
      at: base + index * 100, usd: 100_000 + index, percentile: null, rank: 1,
      quantity: 1 + index / 100_000, quantityExact: `1.${String(index).padStart(8, '0')}`,
      notionalExact: String(100_000 + index),
    }));
    const segment: OrderWallSegment = {
      id: 'archive-long-value-run', archiveEntryId: 'archive-candidate', epoch: 1, side: 'bid', price: 100,
      start: base, end: base + valueRuns.length * 100, peakUsd: 199_999, meanUsd: 150_000,
      durationMs: valueRuns.length * 100, percentile: null, scopePartial: true, startKnown: true,
      detectionMode: 'top-levels', rank: 1, valueRuns, valueRunsTruncated: false, endReason: 'rank-exit', endKnown: true,
    };
    primitive.setSnapshot([segment], { state: 'live', lastConfirmedAt: segment.end! });
    primitive.draw(canvas(), context({ from: 1, to: 1.02 }));

    expect(primitive.diagnostics().retainedSegments).toBe(1);
    expect(primitive.diagnostics().retainedDrawables).toBeLessThan(20);
    expect(segment.valueRuns).toHaveLength(100_000);
    expect(primitive.orderWallAt(50.5, 100)?.segment.valueRuns[603]?.notionalExact).toBe('100603');
  });

  it('coalesces bid/ask runs per episode without changing side colors or zoomed hover time', () => {
    const primitive = new OrderWallsPrimitive({ ...LEGACY_ORDER_WALLS_SETTINGS, enabled: true, colorMode: 'bid-ask' }, 60_000);
    const segment = (id: string, side: 'bid' | 'ask'): OrderWallSegment => ({
      id, epoch: 1, side, price: 100, start: base, end: base + 60_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 60_000, percentile: 98,
      scopePartial: false, startKnown: true,
      valueRuns: [
        { at: base, usd: 10_000, percentile: 98 },
        { at: base + 30_000, usd: 10_000, percentile: 100 },
      ], valueRunsTruncated: false, endReason: 'removed', endKnown: true,
    });
    primitive.setSnapshot([segment('bid-episode', 'bid'), segment('ask-episode', 'ask')], {
      state: 'live', lastConfirmedAt: base + 60_000,
    });
    const styles: string[] = [], paths: CapturedPath[] = [];
    primitive.draw(canvas(styles, paths), context());
    expect(styles).toEqual(['#2ebc79', '#ed5964']);
    expect(paths).toHaveLength(2);

    const zoomPaths: CapturedPath[] = [];
    primitive.draw(canvas([], zoomPaths), context({ to: 1, xPerIndex: 200, dpr: 2 }));
    expect(zoomPaths[0]?.points).toEqual([[100, 200], [500, 200]]);
    expect(primitive.orderWallAt(150, 100)?.at).toBe(base + 30_000);
  });

  it('keeps Auto selected while zoom changes the shared detector and chart band width', () => {
    const settings = { ...LEGACY_ORDER_WALLS_SETTINGS, enabled: true, aggregation: 'auto' as const };
    const primitive = new OrderWallsPrimitive(settings, 60_000);
    const segment: OrderWallSegment = {
      id: 'auto-wall', epoch: 1, side: 'bid', price: 100, start: base, end: base + 120_000,
      peakUsd: 10_000, meanUsd: 10_000, durationMs: 120_000, percentile: 100,
      scopePartial: false, startKnown: true,
      valueRuns: [{ at: base, usd: 10_000, percentile: 100 }], valueRunsTruncated: false,
      endReason: 'removed', endKnown: true,
    };
    primitive.setSnapshot([segment], {
      state: 'live', tickSize: 0.1,
      resolvedPriceWidth: resolveAutoOrderWallPriceWidth(49_999, 50_001, 300, 0.1),
      lastConfirmedAt: base + 120_000,
    });
    primitive.draw(canvas(), context());
    expect(primitive.orderWallAt(100, 100)?.priceHigh).toBeCloseTo(100.1);

    primitive.setStatus({
      state: 'live', tickSize: 0.1,
      resolvedPriceWidth: resolveAutoOrderWallPriceWidth(49_000, 51_000, 300, 0.1),
      lastConfirmedAt: base + 120_000,
    });
    primitive.draw(canvas(), context());
    expect(settings.aggregation).toBe('auto');
    expect(primitive.orderWallAt(100, 100)?.priceHigh).toBe(200);
  });
});

describe('Order Walls fit range', () => {
  it('fits only active Top Levels and adds padding around the selected prices', () => {
    const segment = (id: string, price: number, end: number | null, mode: 'top-levels' | 'threshold' = 'top-levels'): OrderWallSegment => ({
      id, epoch: 1, side: 'bid', price, start: base, end, peakUsd: 1, meanUsd: 1, durationMs: 1,
      percentile: 99, scopePartial: false, startKnown: true, detectionMode: mode, currentSelection: end === null && mode === 'top-levels',
      valueRuns: [], valueRunsTruncated: false, endReason: end === null ? null : 'rank-exit', endKnown: end !== null,
    });
    const active = [
      segment('active-low', 100, null), segment('active-high', 110, null),
      { ...segment('historical-open', 80, null), currentSelection: false },
      segment('closed', 90, base + 1000), segment('threshold', 1000, null, 'threshold'),
    ];
    const range = orderWallsFitRange(active, 0.01, true);
    expect(range).toEqual({ min: 99.2, max: 110.8 });
    expect(orderWallsFitRange(active, 0.01, false)).toBeNull();
    expect(orderWallsFitRange([segment('closed-only', 100, base + 1000)], 0.01, true)).toBeNull();
    expect(orderWallsFitRange([{ ...segment('historical-open', 100, null), currentSelection: false }], 0.01, true)).toBeNull();
  });
});


describe('optional Order Walls price guides', () => {
  const wall = (id='active',end:number|null=null):OrderWallSegment => ({
    id,epoch:1,side:'bid',price:100,start:base,end,peakUsd:2_000_000,meanUsd:900_000,durationMs:120_000,
    percentile:99,scopePartial:false,startKnown:true,endKnown:end!==null,endReason:end===null?null:'removed',
    valueRuns:[{at:base,usd:500_000,percentile:95},{at:base+60_000,usd:1_200_000,percentile:99}],valueRunsTruncated:false,
  });
  function render(primitive:OrderWallsPrimitive){
    const texts:string[]=[],paths:CapturedPath[]=[];
    const ctx=canvas([],paths) as any;
    ctx.measureText=(text:string)=>({width:text.length*10});ctx.fillRect=()=>{};ctx.strokeRect=()=>{};
    ctx.fillText=(text:string)=>texts.push(text);
    const rc=context();(rc as any).theme={background:'#090909',axisText:'#858585'};
    primitive.draw(ctx,rc);return {texts,paths};
  }
  it('is opt-in, uses latest confirmed notional and bucket centre, and excludes ended walls',()=>{
    const primitive=new OrderWallsPrimitive({...LEGACY_ORDER_WALLS_SETTINGS,enabled:true,aggregation:50},60_000);
    primitive.setSnapshot([wall(),wall('historical',base+120_000)],{state:'live',lastConfirmedAt:base+120_000});
    expect(render(primitive).texts).toEqual([]);
    primitive.setSettings({...LEGACY_ORDER_WALLS_SETTINGS,enabled:true,aggregation:50,showPriceLines:true});
    expect(render(primitive).texts).toEqual(['B 125 · $1.2M']);
    primitive.patch([{id:'active',segment:{...wall(),valueRuns:[{at:base,usd:750_000,percentile:95}]}}],{state:'stale',lastConfirmedAt:base+120_000});
    expect(render(primitive).texts).toEqual(['~B 125 · $750K']);
  });
  it('suppresses overlapping tags without hiding guides or inventing history',()=>{
    const primitive=new OrderWallsPrimitive({...LEGACY_ORDER_WALLS_SETTINGS,enabled:true,showPriceLines:true},60_000);
    primitive.setSnapshot([wall(),wall('second')],{state:'live',lastConfirmedAt:base+120_000});
    const result=render(primitive);
    expect(result.texts).toHaveLength(1);
    expect(result.paths.filter(path=>path.points[0]?.[0]===0)).toHaveLength(2);
    expect(primitive.diagnostics().retainedSegments).toBe(2);
  });
});

describe('Top Levels native rendering',()=>{
 const top=(id:string,usd:number,start=base):OrderWallSegment=>({id,epoch:1,detectionMode:'top-levels',rank:1,side:'bid',price:100,start,end:start+120000,peakUsd:usd,meanUsd:usd,durationMs:120000,percentile:null,scopePartial:false,startKnown:true,valueRuns:[{at:start,usd,percentile:null,rank:1,quantity:usd/100}],valueRunsTruncated:false,endReason:'rank-exit',endKnown:true});
 it('coalesces adjacent same-strength spans without discarding exact historical ranks or quantity',()=>{
  const settings={...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,aggregation:'native' as const};
  const p=new OrderWallsPrimitive(settings,60000),a=top('a',10),b=top('b',100);
  a.valueRuns.push({at:base+60000,usd:12,percentile:null,rank:2,quantity:.12});
  p.setSnapshot([a,b],{state:'live',tickSize:.1});const paths:CapturedPath[]=[];p.draw(canvas([],paths),context());
  expect(paths).toHaveLength(2);expect(paths[0]?.points).toEqual([[100,200],[500,200]]);
  expect(p.orderWallAt(150,100)?.segment.valueRuns[1]).toMatchObject({rank:2,quantity:.12});
  expect(p.orderWallAt(150,100)?.segment.endReason).toBe('rank-exit');
 });
 it('Visible Range Only changes styling references without changing episodes or retained data',()=>{
  const p=new OrderWallsPrimitive({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true},60000),segments=[top('a',100),top('b',200),top('offscreen',10000,base+600000)];
  p.setSnapshot(segments,{state:'live',tickSize:.1});const visible:string[]=[];p.draw(canvas(visible),context());
  expect(visible).toEqual(['#33778c','#ff884d']);
  p.setSettings({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,visibleRangeOnly:false});const retained:string[]=[];p.draw(canvas(retained),context());
  expect(retained).toEqual(['#33778c']); // Same-style paths share a stroke without joining episodes.
  expect(p.diagnostics().retainedSegments).toBe(3);
  expect(segments[0]!.valueRuns).toEqual([{at:base,usd:100,percentile:null,rank:1,quantity:1}]);
 });
 it('confirmation never draws before its availability, and historical episodes have a bounded render cache',()=>{
  const p=new OrderWallsPrimitive({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,minDurationMs:60000,historyEpisodes:16},60000);
  const segments=Array.from({length:20},(_,i)=>top('episode-'+i,100+i));p.setSnapshot(segments,{state:'live',tickSize:.1});const paths:CapturedPath[]=[];p.draw(canvas([],paths),context());
  expect(p.diagnostics().retainedSegments).toBe(16);expect(paths.every(path=>path.points[0]![0]>=300)).toBe(true);
 });
 it('hover uses the latest closed episode metadata even for an earlier un-reprojected run',()=>{
  const p=new OrderWallsPrimitive({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true},60000),segment=top('mutable',100);segment.end=null;
  p.setSnapshot([segment],{state:'live',tickSize:.1,lastConfirmedAt:base+120000});p.draw(canvas(),context());
  const closed={...segment,end:base+120000,endReason:'rank-exit' as const};p.patch([{id:segment.id,segment:closed}],{state:'live',tickSize:.1,lastConfirmedAt:base+120000});p.draw(canvas(),context());
  expect(p.orderWallAt(150,100)?.segment).toMatchObject({end:base+120000,endReason:'rank-exit'});
 });
});

it('paints an instantaneous current selection without inventing a historical duration',()=>{
 const primitive=new OrderWallsPrimitive({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,mode:'top-levels',aggregation:'native'},60000);
 const start=base+60000,segment:OrderWallSegment={id:'current-point',epoch:1,side:'bid',price:100,start,end:null,peakUsd:1000,meanUsd:1000,durationMs:0,percentile:null,scopePartial:true,startKnown:false,currentSelection:true,detectionMode:'top-levels',rank:1,valueRuns:[{at:start,usd:1000,percentile:null,rank:1,quantity:10}],valueRunsTruncated:false,endReason:null,endKnown:false};
 const paths:CapturedPath[]=[];primitive.setSnapshot([segment],{state:'live',lastConfirmedAt:start});primitive.draw(canvas([],paths),context());
 expect(primitive.diagnostics().visibleCurrent).toBe(1);expect(paths[0]!.points[1]![0]-paths[0]!.points[0]![0]).toBe(1);
 expect(primitive.orderWallAt(150.1,100)?.at).toBe(start);
 primitive.setSnapshot([{...segment,id:'historical-point',archiveEntryId:'old',currentSelection:false,end:start,endKnown:true}],{state:'live',lastConfirmedAt:start});primitive.draw(canvas(),context());
 expect(primitive.diagnostics().visible).toBe(0);
});

it('a confirmation-only patch extends only open geometry and does not inspect closed history',()=>{
 const primitive=new OrderWallsPrimitive({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,mode:'top-levels',aggregation:'native',visibleRangeOnly:false},60000);
 const open:OrderWallSegment={id:'open-confirmation',epoch:1,side:'bid',price:100,start:base,end:null,peakUsd:1000,meanUsd:1000,durationMs:0,percentile:null,scopePartial:true,startKnown:false,currentSelection:true,detectionMode:'top-levels',rank:1,valueRuns:[{at:base,usd:1000,percentile:null,rank:1,quantity:10}],valueRunsTruncated:false,endReason:null,endKnown:false};
 let closedReads=0;const closed:OrderWallSegment={...open,id:'closed-untouched',archiveEntryId:'old',currentSelection:false,end:base+1000};
 Object.defineProperty(closed,'end',{get(){closedReads++;return base+1000;}});
 primitive.setSnapshot([closed,open],{state:'live',lastConfirmedAt:base+1000});primitive.draw(canvas(),context());
 const before=primitive.diagnostics(),reads=closedReads,paths:CapturedPath[]=[];
 primitive.patch([],{state:'live',lastConfirmedAt:base+30000});primitive.draw(canvas([],paths),context());
 expect(closedReads).toBe(reads);expect(primitive.diagnostics().patchProjects-before.patchProjects).toBe(1);expect(primitive.diagnostics().rebuilds).toBe(before.rebuilds);
 const hit=primitive.orderWallAt(90,100);expect(hit?.segment.id).toBe('open-confirmation');expect(hit?.at).toBeGreaterThan(base+1000);
});

it('advances a delivered archive tail only with archive coverage, independently of current confirmation',()=>{
 const primitive=new OrderWallsPrimitive({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,mode:'top-levels',aggregation:'native'},60000);
 const segment:OrderWallSegment={id:'archive-tail',archiveEntryId:'entry',epoch:1,side:'bid',price:100,start:base,end:null,peakUsd:1000,meanUsd:1000,durationMs:60000,percentile:null,scopePartial:true,startKnown:true,currentSelection:false,detectionMode:'top-levels',rank:1,valueRuns:[{at:base,usd:1000,percentile:null,rank:1,quantity:10}],valueRunsTruncated:false,endReason:null,endKnown:false};
 const status:any={state:'live',lastConfirmedAt:base+30000,archive:{loadedThrough:base+1000}};
 primitive.setSnapshot([segment],status);primitive.draw(canvas(),context());expect(primitive.orderWallAt(90,100)).toBeNull();
 primitive.patch([],{...status,archive:{loadedThrough:base+30000}});primitive.draw(canvas(),context());expect(primitive.orderWallAt(90,100)?.segment.id).toBe('archive-tail');
 const projects=primitive.diagnostics().patchProjects;
 primitive.patch([],{...status,lastConfirmedAt:base+60000,archive:{loadedThrough:base+30000}});primitive.draw(canvas(),context());expect(primitive.diagnostics().patchProjects).toBe(projects);
});

for(const visibleRangeOnly of [false,true])it(`does not rescan closed wall strength when a current value changes (visible=${visibleRangeOnly})`,()=>{
 const settings={...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,aggregation:'native' as const,visibleRangeOnly,showHistory:true};
 const wall=(id:string,end:number|null,usd:number):OrderWallSegment=>({id,archiveEntryId:id,epoch:1,side:'bid',price:100,start:base,end,peakUsd:usd,meanUsd:usd,durationMs:120000,percentile:null,scopePartial:false,startKnown:true,endKnown:end!==null,endReason:end===null?null:'removed',detectionMode:'top-levels',rank:1,valueRuns:[{at:base,usd,percentile:null,rank:1,quantity:1}],valueRunsTruncated:false});
 let closedRunReads=0,closedLineReads=0;
 const closed=Array.from({length:100},(_,i)=>{const s=wall('closed-reference-'+i,base+120000,i+1);Object.defineProperty(s.valueRuns[0],'usd',{get(){closedRunReads++;return i+1;},enumerable:true});return s;});
 const current={...wall('current-reference',null,200),currentSelection:true};
 const primitive=new OrderWallsPrimitive(settings,60000),status={state:'live' as const,lastConfirmedAt:base+120000,tickSize:.1};
 primitive.setSnapshot([...closed,current],status);primitive.draw(canvas(),context());
 for(const line of (primitive as any).drawable.values())if(line.segment.id.startsWith('closed-reference-')){const usd=line.usd;Object.defineProperty(line,'usd',{get(){closedLineReads++;return usd;}});}
 closedRunReads=0;closedLineReads=0;primitive.draw(canvas(),context());const paintReads=closedLineReads;
 closedRunReads=0;closedLineReads=0;
 primitive.patch([{id:current.id,segment:{...current,peakUsd:400,meanUsd:400,valueRuns:[{at:base,usd:400,percentile:null,rank:1,quantity:4}]}}],status);
 primitive.draw(canvas(),context());
 expect(closedRunReads).toBe(0);expect(closedLineReads).toBe(paintReads);
 expect((primitive as any).reference).toEqual({min:1,max:400});
});

it('keeps strength extrema equal to an independent scan through revisions, viewport changes and retention',()=>{
 const wall=(id:string,values:number[],closed=true):OrderWallSegment=>({id,epoch:1,side:'bid',price:100,start:base,end:closed?base+120000:null,peakUsd:Math.max(...values),meanUsd:values[0]!,durationMs:120000,percentile:null,scopePartial:false,startKnown:true,endKnown:closed,endReason:closed?'removed':null,detectionMode:'top-levels',rank:1,valueRuns:values.map((usd,i)=>({at:base+i*30000,usd,percentile:null,rank:1,quantity:1})),valueRunsTruncated:false});
 let settings={...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,aggregation:'native' as const,visibleRangeOnly:false,historyEpisodes:20};
 const p=new OrderWallsPrimitive(settings,60000),status={state:'live' as const,lastConfirmedAt:base+120000,tickSize:.1};
 let rc=context();
 function verify(){
  p.draw(canvas(),rc);const model=p as any;let values:number[]=[];
  if(settings.visibleRangeOnly)values=[...model.drawable.values()].map((line:any)=>line.usd).filter((v:any)=>v!==null&&v>0);
  else values=[...model.segments.values()].flatMap((s:any)=>settings.showHistory||s.end===null?s.valueRuns.map((v:any)=>v.usd).filter((v:any)=>v!==null&&v>0):[]);
  expect(model.reference).toEqual({min:values.length?Math.min(...values):0,max:values.length?Math.max(...values):0});
 }
 p.setSnapshot([wall('min',[1,3]),wall('max',[1000,500]),wall('duplicate',[1,1000]),wall('current',[20],false)],status);verify();
 p.patch([{id:'max',segment:wall('max',[50,60])}],status);verify();
 p.patch([{id:'duplicate',segment:null}],status);verify();
 p.patch([{id:'min',segment:wall('min',[25,30])}],status);verify();
 p.patch([{id:'current',segment:wall('current',[20,2000],false)}],status);verify();
 p.patch([{id:'current',segment:wall('current',[20,15],false)}],status);verify();
 rc=context({from:.5,to:2});verify();expect(p.diagnostics().referenceSegments).toBe(0);
 settings={...settings,visibleRangeOnly:true};p.setSettings(settings);verify();
 rc=context({from:1,to:2});verify();
 p.patch([{id:'current',segment:wall('current',[800],false)}],status);verify();
 settings={...settings,visibleRangeOnly:false,showHistory:false};p.setSettings(settings);verify();
 settings={...settings,showHistory:true,historyEpisodes:1};p.setSettings(settings);verify();
 p.patch([...((p as any).segments.keys())].map(id=>({id,segment:null})),status);verify();
 expect(p.diagnostics().retainedReferenceSegments).toBe(0);expect(p.diagnostics().retainedDrawables).toBe(0);expect(p.orderWallAt(100,100)).toBeNull();
 p.patch([{id:'reopened',segment:wall('reopened',[7],false)}],status);verify();
 p.setSnapshot([],status);expect(p.diagnostics().visibleHistorical).toBe(0);expect(p.diagnostics().visibleCurrent).toBe(0);expect(p.diagnostics().retainedReferenceSegments).toBe(0);
 p.detached();expect(p.diagnostics().retainedReferenceSegments).toBe(0);
});

it('bounds pending strength/geometry work by retained data while a chart is not being drawn',()=>{
 const settings={...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,aggregation:'native' as const,visibleRangeOnly:false,historyEpisodes:2};
 const p=new OrderWallsPrimitive(settings,60000),status={state:'live' as const,lastConfirmedAt:base+120000};
 const wall=(i:number):OrderWallSegment=>({id:'hidden-'+i,epoch:1,side:'bid',price:100,start:base,end:base+120000,peakUsd:i+1,meanUsd:i+1,durationMs:120000,percentile:null,scopePartial:false,startKnown:true,endKnown:true,endReason:'removed',detectionMode:'top-levels',rank:1,valueRuns:[{at:base,usd:i+1,percentile:null,rank:1,quantity:1}],valueRunsTruncated:false});
 p.setSnapshot([wall(0),wall(1)],status);p.draw(canvas(),context());
 for(let i=2;i<1000;i++)p.patch([{id:'hidden-'+i,segment:wall(i)}],status);
 const model=p as any;
 expect(p.diagnostics().retainedSegments).toBe(2);expect(model.dirty.size).toBeLessThanOrEqual(2);expect(model.tailDirty.size).toBeLessThanOrEqual(2);
 expect(model.referenceIds.size).toBeLessThanOrEqual(2);expect(model.referenceExtents.size).toBeLessThanOrEqual(2);expect(model.referenceCounts.size).toBeLessThanOrEqual(4);
 p.draw(canvas(),context());expect(model.reference).toEqual({min:999,max:1000});
 p.patch([{id:'hidden-998',segment:null},{id:'hidden-999',segment:null}],status);
 expect(p.diagnostics().retainedDrawables).toBe(0);expect(p.diagnostics().retainedReferenceSegments).toBe(0);expect(p.orderWallAt(100,100)).toBeNull();
});

it('reprojects an earlier value revision when the canonical patch explicitly replaces its runs',()=>{
 const p=new OrderWallsPrimitive({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,aggregation:'native',visibleRangeOnly:true},60000);
 const segment:OrderWallSegment={id:'revised-runs',archiveEntryId:'entry-revised',epoch:1,side:'bid',price:100,start:base,end:base+120000,peakUsd:500,meanUsd:300,durationMs:120000,percentile:null,scopePartial:false,startKnown:true,endKnown:true,endReason:'removed',detectionMode:'top-levels',rank:1,valueRuns:[{at:base,usd:100,percentile:null,rank:1},{at:base+60000,usd:500,percentile:null,rank:1}],valueRunsTruncated:false};
 const status={state:'live' as const,lastConfirmedAt:base+120000};p.setSnapshot([segment],status);p.draw(canvas(),context());
 p.patch([{id:segment.id,segment:{...segment,peakUsd:900,valueRuns:[{...segment.valueRuns[0]!,usd:900},segment.valueRuns[1]!]},replaceValueRuns:true}],status);p.draw(canvas(),context());
 expect([...(p as any).drawable.values()].find((line:any)=>line.runIndex===0).usd).toBe(900);
 expect((p as any).reference).toEqual({min:500,max:900});
});

it('cached native paths match immediate drawing and invalidate for updates, removal, view, style and detach',()=>{
 class TestPath {points:Array<[number,number]>=[];moveTo(x:number,y:number){this.points.push([x,y]);}lineTo(x:number,y:number){this.points.push([x,y]);}}
 const segment=(id:string,side:'bid'|'ask',usd:number):OrderWallSegment=>({id,archiveEntryId:id,epoch:1,side,price:100,start:base,end:base+120000,peakUsd:usd,meanUsd:usd,durationMs:120000,percentile:null,scopePartial:false,startKnown:true,detectionMode:'top-levels',valueRuns:[{at:base,usd,percentile:null},{at:base+60000,usd:usd*2,percentile:null}],valueRunsTruncated:false,endReason:'rank-exit',endKnown:true});
 const settings={...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,mode:'top-levels' as const,aggregation:'native' as const},a=segment('A','bid',100),b=segment('B','ask',200);
 const cached=new OrderWallsPrimitive(settings,60000),reference=new OrderWallsPrimitive(settings,60000,false),status={state:'stale' as const,lastConfirmedAt:base+120000,tickSize:.01};
 const captured=()=>{const paths:Array<{color:string;points:Array<[number,number]>}>=[],ctx:any=canvas([],paths),old=ctx.stroke;ctx.stroke=(path?:TestPath)=>{if(path)paths.push({color:ctx.strokeStyle,points:[...path.points]});else old();};return {ctx,paths};};
 vi.stubGlobal('Path2D',TestPath);
 try{
  cached.setSnapshot([a,b],status);reference.setSnapshot([a,b],status);
  const compare=(rc=context())=>{const x=captured(),y=captured();cached.draw(x.ctx,rc);reference.draw(y.ctx,rc);expect(x.paths).toEqual(y.paths);expect(cached.orderWallAt(150,100)).toEqual(reference.orderWallAt(150,100));};
  compare();const visits=cached.stats.paintStyleVisits;compare();expect(cached.stats.paintCacheHits).toBe(1);expect(cached.stats.paintStyleVisits).toBe(visits);
  const outside={...segment('outside','bid',100),start:base+600000,end:base+720000,valueRuns:[{at:base+600000,usd:100,percentile:null}]};
  for(const p of [cached,reference])p.patch([{id:outside.id,segment:outside,replaceValueRuns:true}],status);compare();expect(cached.stats.paintCacheHits).toBe(2);expect(cached.stats.paintStyleVisits).toBe(visits);
  const next={...a,valueRuns:[...a.valueRuns,{at:base+90000,usd:1000,percentile:null}],peakUsd:1000};
  for(const p of [cached,reference])p.patch([{id:a.id,segment:next,replaceValueRuns:true}],status);compare();expect(cached.stats.paintCacheBuilds).toBe(2);
  for(const p of [cached,reference])p.patch([{id:b.id,segment:null}],status);compare();expect(cached.stats.paintCacheBuilds).toBe(3);
  compare(context({from:1,to:3,dpr:1}));expect(cached.stats.paintCacheBuilds).toBe(4);
  for(const p of [cached,reference])p.setSettings({...settings,colorMode:'bid-ask'});compare();expect(cached.stats.paintCacheBuilds).toBe(5);
  expect(cached.diagnostics().retainedPaintPaths).toBeGreaterThan(0);cached.detached();expect(cached.diagnostics().retainedPaintPaths).toBe(0);expect(cached.diagnostics().retainedDrawables).toBe(0);
 }finally{vi.unstubAllGlobals();}
});

it('received prepared walls paint their confirmed geometry while whole-view coverage stays incomplete',()=>{
 const primitive=new OrderWallsPrimitive({...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,mode:'top-levels',aggregation:'native'},60000);
 const segment:OrderWallSegment={id:'prepared-active',archiveEntryId:'A',epoch:1,side:'bid',price:100,start:base,end:null,peakUsd:200,meanUsd:150,durationMs:120000,percentile:null,scopePartial:true,startKnown:false,detectionMode:'top-levels',valueRuns:[{at:base,usd:100,percentile:null},{at:base+60000,usd:200,percentile:null}],valueRunsTruncated:false,endReason:null,endKnown:false};
 const archive:any={profileId:'fixture',state:'loading',from:base,to:base+120000,loadedThrough:base,presentationThrough:base+120000,requestComplete:false,rangeComplete:false,gaps:[]};
 primitive.setSnapshot([segment],{state:'loading',archive});const paths:CapturedPath[]=[];primitive.draw(canvas([],paths),context());
 expect(primitive.orderWallAt(200,100)?.at).toBe(base+90000);expect(paths.flatMap(path=>path.points).some(([x])=>x===500)).toBe(true);
 expect(archive.loadedThrough).toBe(base);expect(archive.requestComplete).toBe(false);
 primitive.setStatus({state:'loading',archive:{...archive,presentationThrough:base+60000}});primitive.draw(canvas(),context());expect(primitive.orderWallAt(200,100)).toBeNull();
});

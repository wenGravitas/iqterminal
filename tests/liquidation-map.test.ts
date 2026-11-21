import { test, expect } from 'vitest';
import { mapSettings } from '../src/liquidation-map/model';
import { exposureRows, selectedCells } from '../src/liquidation-map/chart';
const cell = { low: 100, high: 110, quantity: 10, side: 'long' as const, venue: 'bybit' as const, kind: 'estimated' as const, scenario: 'a', leverage: 10, quote: 'USDT', nativePrice: 105, modelVersion: 'v1', riskVersion: 'r1' };
test('map and profile average alternative scenario stock rather than summing it', () => { const c = { at: 1, availableAt: 1, revision: 1, quality: [], cells: [cell, { ...cell, scenario: 'b', quantity: 20 }] }; expect(exposureRows(c, mapSettings(undefined), 'USDT').get(100)).toBe(15); });
test('native quote valuation excludes a different quote, base view retains explicit source price', () => { const c = { at: 1, availableAt: 1, revision: 1, quality: [], cells: [cell, { ...cell, kind: 'observed' as const, venue: 'hyperliquid' as const, quote: 'USD', leverage: null }] }; expect(selectedCells(c, mapSettings({ units: 'native-quote' }), 'USDT')).toHaveLength(1); expect(selectedCells(c, mapSettings(undefined), 'USDT')).toHaveLength(2); });
test('empty source and leverage selections persist without reverting to defaults', () => { expect(mapSettings({ venues: [], leverage: [] })).toMatchObject({ venues: [], leverage: [] }); });
import { vi } from 'vitest';
import { LiquidationMapPrimitive,spectrum } from '../src/liquidation-map/chart';
test('resident horizontal navigation reuses native geometry and zoom invalidates it', () => { class Path {
    rect = vi.fn();
} vi.stubGlobal('Path2D', Path); try {
    let pan = 0, spacing = 7;
    const at = 1800000000000, p = new LiquidationMapPrimitive();
    p.settings = mapSettings({ profile: false });
    p.columns = [{ at: at + 120000, availableAt: at + 120000, revision: 1, quality: [], cells: [{ ...cell, kind: 'observed', leverage: null }] }];
    const fills: unknown[] = [], translations: number[] = [];
    const ctx = { save() { }, restore() { }, beginPath() { }, rect() { }, clip() { }, fill(path: unknown) { fills.push(path); }, fillText() { }, translate(x: number) { translations.push(x); } } as any;
    const rc = { dpr: 1, plotWidth: 500, plotHeight: 500, theme: { axisText: '#aaa' }, timeScale: { visibleRange: () => ({ from: 0, to: 20 }), get barSpacing() { return spacing; }, indexToX: (i: number) => 20 + i * spacing + pan }, dataLayer: { length: 21, indexToTimeFloat: (i: number) => at / 1000 + i * 60, timeToIndexFloat: (t: number) => (t - at / 1000) / 60 }, priceScale: { priceRange: () => ({ min: 0, max: 1000 }), priceToY: (price: number) => (1000 - price) / 2 } } as any;
    p.draw(ctx, rc);
    pan = 5;
    p.draw(ctx, rc);
    expect(fills).toHaveLength(2);
    expect(fills[1]).toBe(fills[0]);
    expect(translations).toContain(5);
    spacing = 14;
    p.draw(ctx, rc);
    expect(fills[2]).not.toBe(fills[0]);
}
finally {
    vi.unstubAllGlobals();
} });
import { packMap, unpackMap } from '../src/liquidation-map/wire';
test('transferable map buffers retain Float64 prices, scenarios and native quote identities', () => { const payload = { version: 1 as const, semantics: 'conditional-exposure' as const, columns: [{ at: 1800000000001, availableAt: 1800000000002, revision: 1, cells: [{ ...cell, nativePrice: 57942.123456789, quote: 'USDT' }], quality: ['subset'] }], sources: [], head: 1, next: null, from: 1, to: 2, resolution: 60000, priceWidth: 100, asOf: 1800000000003 }; const wire = packMap(payload); expect(wire.values.buffer).toBeInstanceOf(ArrayBuffer); expect(unpackMap({ ...payload, columns: [] }, wire)).toEqual(payload); });

import {mapColumnAt} from '../src/liquidation-map/model';
test('map and profile inspection use availability rather than a later event-time revision',()=>{
 const first={at:1,availableAt:10,revision:1,cells:[cell],quality:[]},later={at:2,availableAt:30,revision:2,cells:[cell],quality:[]};
 expect(mapColumnAt([first,later],9)).toBeUndefined();
 expect(mapColumnAt([first,later],20)).toBe(first);
 expect(mapColumnAt([first,later],30)).toBe(later);
 expect(mapColumnAt([first,later],Infinity)).toBe(later);
});

import {mapColumnEnd} from '../src/liquidation-map/model';
test('fine time grouping carries stock to the next snapshot without extending a known closure',()=>{
 const first={at:0,availableAt:0,revision:1,cells:[cell],quality:[]},next={...first,availableAt:50000};
 expect(mapColumnEnd(first,next,10000)).toBe(50000);
 expect(mapColumnEnd(first,undefined,10000)).toBe(120000);
 expect(mapColumnEnd(first,undefined,600000)).toBe(600000);
 expect(mapColumnEnd({...first,resolution:600000},undefined,10000)).toBe(600000);
});

import {freshProfile} from '../src/liquidation-map/model';
test('explicit first removal bounds a coarse band without a delivered successor',()=>{
 const column={at:0,availableAt:0,validUntil:50000,revision:1,cells:[cell],quality:[]};
 expect(mapColumnEnd(column,undefined,240000)).toBe(50000);
 expect(mapColumnEnd(column,{...column,availableAt:150000},240000)).toBe(50000);
});
test('latest profile uses source and native mark age without aging immutable history',()=>{
 const now=Date.now(),column={at:now-1000,availableAt:now-1000,revision:1,quality:[],cells:[{...cell,freshUntil:now+5000,markSourceTime:now-16000,markReceivedAt:now},{...cell,scenario:'b',freshUntil:now+5000,markSourceTime:now-1000}]};
 expect(freshProfile(column,now)?.cells).toHaveLength(1);expect(column.cells).toHaveLength(2);
 expect(freshProfile(column,now+6000)?.cells).toHaveLength(0);
});
test('latest profile and explicit validity travel in the same bounded worker buffer',()=>{
 const now=Date.now(),column={at:now,availableAt:now,validUntil:now+50000,revision:1,quality:[],cells:[cell]};
 const payload={version:1,columns:[column],profile:{...column,cells:[]},sources:[],head:1,next:null,from:0,to:now,resolution:240000,priceWidth:10,semantics:'conditional-exposure',asOf:now} as const;
 const wire=packMap(payload as any),result=unpackMap({...payload,columns:[],profile:undefined} as any,wire);
 expect(result.columns[0].validUntil).toBe(now+50000);expect(result.profile?.cells).toEqual([]);expect(result.columns).toHaveLength(1);
});
test('offscreen price outlier cannot flatten visible auto heatmap or profile',()=>{
 const previous=globalThis.Path2D;globalThis.Path2D=class {rect(){}} as any;
 try{
 const p=new LiquidationMapPrimitive(),now=Date.now();p.settings=mapSettings({minimum:0});p.columns=[{at:now,availableAt:now,revision:1,quality:[],cells:[{...cell,quantity:10},{...cell,low:10000,high:10010,quantity:1e9}]}];p.profile=p.columns[0];
 const colours:string[]=[];let colour='';const widths:number[]=[];
 const ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},translate(){},fill(){colours.push(colour);},fillText(){},fillRect(_x:number,_y:number,w:number){widths.push(w);},set fillStyle(v:string){colour=v;},get fillStyle(){return colour;}} as any;
 const rc={dpr:1,plotWidth:500,plotHeight:500,theme:{axisText:'#aaa'},timeScale:{visibleRange:()=>({from:0,to:20}),barSpacing:10,indexToX:(i:number)=>i*10},dataLayer:{length:21,indexToTimeFloat:(i:number)=>now/1000+i*60,timeToIndexFloat:(t:number)=>(t-now/1000)/60},priceScale:{priceRange:()=>({min:0,max:1000}),priceToY:(price:number)=>(1000-price)/2}} as any;
 p.draw(ctx,rc);expect(colours).toContain(spectrum(1));expect(widths[0]).toBe(100);
 }finally{globalThis.Path2D=previous;}
});

import {compactMapColumns} from '../src/liquidation-map/lod';
test('metadata compaction preserves first retirement, partial changes and new exposure at the same price',()=>{
 const base={at:0,availableAt:0,revision:1,quality:[],cells:[cell]},columns=[{...base,validUntil:5000},{...base,at:5000,availableAt:5000,validUntil:10000,cells:[{...cell,nativePrice:105.1}]},{...base,at:10000,availableAt:10000,validUntil:45000,cells:[{...cell,nativePrice:105.2}]},{...base,at:45000,availableAt:45000,validUntil:50000,cells:[{...cell,nativePrice:105.3}]},{...base,at:50000,availableAt:50000,cells:[]},{...base,at:150000,availableAt:150000,cells:[]},{...base,at:200000,availableAt:200000,cells:[cell]}];
 const result=compactMapColumns(columns,240000);expect(result.map(c=>c.availableAt)).toEqual([0,45000,50000,150000,200000]);expect(result[0].validUntil).toBe(45000);expect(mapColumnEnd(result[1],result[2],240000)).toBe(50000);expect(result[0].cells[0].nativePrice).toBe(105);
 const changed=compactMapColumns([{...base,validUntil:5000},{...base,at:5000,availableAt:5000,validUntil:10000,cells:[{...cell,quantity:5}]},{...base,at:10000,availableAt:10000,cells:[{...cell,venue:'binance'}]}],240000);expect(changed).toHaveLength(3);
});

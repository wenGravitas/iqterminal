import {describe,it,expect} from 'vitest';
import {WallResidentHistory,wallResidentOverscan,type ResidentWallChunk} from '../src/feed/wall-resident-history';
import type {OrderWallSegment} from '../src/feed/order-walls';
const segment:OrderWallSegment={id:'source-id',archiveEntryId:'source-entry',epoch:1,side:'bid',price:1,priceExact:'1.00',start:0,end:1000,peakUsd:3,meanUsd:2,durationMs:1000,percentile:null,scopePartial:false,startKnown:true,endKnown:true,endReason:'removed',valueRunsTruncated:false,valueRuns:[{at:0,usd:2,quantityExact:'2.0000000000000000001',notionalExact:'2.0000000000000000001',percentile:null}]};
const chunk=(from:number,to:number,key=String(from)):ResidentWallChunk=>({key,from,to,revision:'validated-'+key,segments:new Map([[segment.id,segment]]),status:{profileId:'p',state:'complete',from,to,eligibleTo:to,loadedThrough:to-1,requestComplete:true,rangeComplete:true,exact:true,gaps:[],requestedTopN:8,requestedBandPercent:10,profileBandPercent:10}});
describe('resident wall interval ownership',()=>{
 it('requests only missing half-open intervals, including both sides of zoom-out',()=>{
  const store=new WallResidentHistory();expect(store.admit(chunk(100,200),{from:100,to:200}).ok).toBe(true);
  expect(store.missing({from:120,to:180})).toEqual([]);expect(store.missing({from:50,to:250})).toEqual([{from:50,to:100},{from:200,to:250}]);
  store.admit(chunk(50,100),{from:50,to:200});expect(store.missing({from:50,to:200})).toEqual([]);
  expect(store.missing({from:200,to:250})).toEqual([{from:200,to:250}]);
 });
 it('retains exact financial records and known gaps without merging range-relative episodes',()=>{
  const store=new WallResidentHistory(),a=chunk(100,200),before=JSON.stringify(segment);a.status.gaps=[{from:130,to:140,reason:'source gap'}];a.status.rangeComplete=false;a.status.state='partial';
  store.admit(a,{from:100,to:200});store.admit(chunk(200,300),{from:100,to:300});
  expect(store.missing({from:100,to:300})).toEqual([]);expect(store.chunks[0]?.status.gaps).toEqual(a.status.gaps);
  expect(store.chunks[0]?.segments.get(segment.id)).toBe(segment);expect(JSON.stringify(segment)).toBe(before);
 });
 it('does not admit pending, unavailable or unconfirmed future coverage',()=>{
  const store=new WallResidentHistory();for(const modify of [(a:ResidentWallChunk)=>a.status.requestComplete=false,(a:ResidentWallChunk)=>a.status.state='unavailable',(a:ResidentWallChunk)=>a.status.eligibleTo=150]){const a=chunk(100,200);modify(a);expect(store.admit(a,{from:100,to:200})).toEqual({ok:false,reason:'invalid'});}expect(store.size).toBe(0);
 });
 it('rejects ambiguous overlaps and explicitly invalidates corrected owned chunks',()=>{
  const store=new WallResidentHistory();store.admit(chunk(100,200),{from:100,to:200});
  expect(store.admit(chunk(150,250),{from:100,to:250})).toEqual({ok:false,reason:'overlap'});
  expect(store.invalidate({from:199,to:201}).map(c=>c.key)).toEqual(['100']);expect(store.missing({from:100,to:200})).toEqual([{from:100,to:200}]);
 });
 it('evicts complete offscreen chunks only and never mutates ownership on failed admission',()=>{
  const store=new WallResidentHistory({chunks:2,segments:2,runs:2,bytes:1536});store.admit(chunk(100,200),{from:100,to:200});store.admit(chunk(200,300),{from:200,to:300});
  expect(store.admit(chunk(300,400),{from:100,to:400})).toEqual({ok:false,reason:'capacity'});expect(store.size).toBe(2);
  const result=store.admit(chunk(300,400),{from:200,to:400});expect(result).toMatchObject({ok:true,removed:[{key:'100'}]});expect(store.diagnostics()).toMatchObject({chunks:2,runs:2,segments:2,bytes:1536});
  store.clear();expect(store.diagnostics()).toMatchObject({chunks:0,runs:0,bytes:0});
 });
 it('replaces an exact owned revision atomically without accumulating generations',()=>{
  const store=new WallResidentHistory();for(let n=0;n<50;n++){const a=chunk(100,200);a.revision=String(n);expect(store.admit(a,{from:100,to:200}).ok).toBe(true);}expect(store.size).toBe(1);expect(store.chunks[0]?.revision).toBe('49');
 });
 it('bounds overscan without rounding away any requested time',()=>{
  expect(wallResidentOverscan({from:100000000,to:208000000},900000)).toEqual({from:96400000,to:211600000});
  expect(wallResidentOverscan({from:0,to:1000},100)).toEqual({from:0,to:1200});
 });
});

it('expands an identical native ownership scope atomically and refuses changed proofs or financial maps',()=>{const store=new WallResidentHistory(),a={...chunk(100,200),sourceToken:'native-source'};a.status={...a.status,from:1,to:300,eligibleTo:300,loadedThrough:299};expect(store.admit(a,{from:100,to:200}).ok).toBe(true);expect(store.expand({...a,from:50,to:250},{from:50,to:250}).ok).toBe(true);const before=store.chunks[0];for(const changed of [{...a,from:40,to:260,revision:'different'},{...a,from:40,to:260,sourceToken:'other'},{...a,from:40,to:260,segments:new Map(a.segments)},{...a,from:40,to:260,status:{...a.status}}]){expect(store.expand(changed,{from:40,to:260}).ok).toBe(false);expect(store.chunks[0]).toBe(before);}});

import {expect,test} from 'vitest';
import {NativeCandlePresentationCache} from '../src/feed/native-candle-presentation-cache';
const rows=(n:number)=>Array.from({length:n},(_,t)=>({t:t+1,o:1,h:2,l:1,c:2,v:3,quoteVolume:6,closed:true,revision:1}));
test('bounds two default entries by1000rows/1MiB, detaches values and does not extend TTL on read',()=>{
 let now=0;const cache=new NativeCandlePresentationCache(()=>now),input=rows(360);cache.put('spot5m',input);cache.put('perpetual15m',rows(120));input[0].quoteVolume=999;
 const copy=cache.read('spot5m')!;expect((copy[0] as any).quoteVolume).toBe(6);copy[0].c=999;expect(cache.read('spot5m')![0].c).toBe(2);
 expect(cache.diagnostics()).toMatchObject({entries:2,rows:480});now=59999;expect(cache.read('spot5m')).toHaveLength(360);now=60000;expect(cache.read('spot5m')).toBeUndefined();expect(cache.diagnostics()).toMatchObject({entries:0,rows:0,accountedBytes:0});
 cache.put('a',rows(700));cache.put('b',rows(700));expect(cache.diagnostics()).toMatchObject({entries:1,rows:700});expect(cache.read('a')).toBeUndefined();cache.clear();expect(cache.diagnostics().rows).toBe(0);
});
test('rejects forming, excessive or nested content instead of dropping financial fields',()=>{
 const cache=new NativeCandlePresentationCache();cache.put('large',rows(1001));cache.put('forming',[{...rows(1)[0],closed:false}]);cache.put('nested',[{...rows(1)[0],extra:{big:[]}} as any]);
 expect(cache.diagnostics()).toMatchObject({entries:0,rows:0,capacityMisses:3});cache.put('valid',rows(1));expect((cache.read('valid')![0] as any).quoteVolume).toBe(6);cache.put('valid',[]);expect(cache.read('valid')).toBeUndefined();
});
test('authoritative corrections update cached values without prolonging other slots TTL',()=>{
 let now=0;const cache=new NativeCandlePresentationCache(()=>now);cache.put('view',rows(5));now=59000;
 const corrected={...rows(1)[0],quoteVolume:9,revision:2};cache.seed('view',[corrected]);expect((cache.read('view')![0] as any).quoteVolume).toBe(9);
 now=60000;expect(cache.read('view')).toBeUndefined();
});

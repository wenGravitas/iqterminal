import {test,expect} from 'vitest';
import {DepthMatrixBook,type DepthMatrixColumn,type MatrixReferenceAnchor} from '../src/feed/depth-matrix';
import {projectOrderBook,displayedBalance} from '../src/order-book/projection';
import {barPieces,pieceLabel,LiquidityRanking,TextMeasurements} from '../src/order-book/pieces';
import {orderBookSettings,serializeOrderBookSettings} from '../src/order-book/settings';
import {restoreValue} from '../src/layout';
import {parseRegistry,newWorkspace,duplicateWorkspace} from '../src/workspaces/model';
const anchor:MatrixReferenceAnchor={price:'100.4',source:'binance-spot',cursor:3,epoch:5,at:1000};
function column(source='binance-spot',shift=0):DepthMatrixColumn{
 const b=new DepthMatrixBook();b.apply({kind:'snapshot',at:1000,cursor:3,epoch:source==='binance-spot'?5:27,
  bids:[[String(100.2+shift),'2'],['99.9','3']],asks:[[String(100.6+shift),'4'],['102','5']],bookScope:{bidFloor:'99',askCeiling:'103'}});
 return {source,label:source,state:'live',message:'test',rows:b.project('99','104','1'),bestBid:b.quote.bestBid,bestAsk:b.quote.bestAsk,mid:String(b.quote.mid),lastAt:1000,ageMs:10,cursor:3,epoch:b.lastEpoch,quantityUnit:'BTC',notionalUnit:'USDT'};
}
test('exact fractional edges and raw price notionals; mixed side and divergent prices remain independent',()=>{
 const s=column(),p=column('binance-perpetual',.5),v=projectOrderBook([s,p],['binance-spot','binance-perpetual'],'1',anchor,1100);
 const middle=v.rows.find(r=>r.index==='100')!;
 expect(middle.bid.quantity).toBe(4);expect(middle.ask.quantity).toBe(4);expect(middle.bid.notional).toBeCloseTo(401.8);expect(middle.ask.notional).toBeCloseTo(402.4);
 expect(v.rows.find(r=>r.index==='101')!.ask.quantity).toBe(4);
 expect(middle.bid.contributions.map(c=>c.epoch)).toEqual([5,27]);
 const b=new DepthMatrixBook();b.apply({kind:'snapshot',at:1000,cursor:1,epoch:1,bids:[['0.29999999','2'],['0.2','3']],asks:[['0.3','4']],bookScope:{bidFloor:'0.1',askCeiling:'0.4'}});
 const rows=b.project('0.2','0.4','0.1');expect(rows[0]!.bidQuantity).toBe(5);expect(rows[1]!.askQuantity).toBe(4);expect(rows[0]!.bidNotional).toBeCloseTo(.29999999*2+.2*3,12);
});
test('source selection is unique; removed, stale and unknown quantities never enter live sums',()=>{
 const s=column(),p=column('binance-perpetual');p.state='stale';
 let v=projectOrderBook([s,p],['binance-spot','binance-spot','binance-perpetual'],'1',anchor,1100);
 expect(v.sources).toHaveLength(2);expect(v.rows[1]!.bid.quantity).toBe(2);expect(v.rows[1]!.bid.coverage).toBe('lower-bound');
 expect(v.rows[1]!.bid.contributions[1]).toMatchObject({live:false,quantity:2});
 v=projectOrderBook([s,p],['binance-spot'],'1',anchor,1100);expect(v.rows[1]!.bid.coverage).toBe('exact');
 s.rows[1]!.bidCoverage='unknown';v=projectOrderBook([s],['binance-spot'],'1',anchor,1100);expect(v.rows[1]!.bid).toMatchObject({quantity:0,notional:0,coverage:'unknown'});
 expect(projectOrderBook([column()],['binance-spot'],'1',anchor,7000).liveSources).toEqual([]);
 const oneSide=column();for(const row of oneSide.rows)row.askCoverage='unknown';expect(displayedBalance(projectOrderBook([oneSide],[oneSide.source],'1',anchor,1100).rows).bidShare).toBeNull();
});
test('partial levels are lower bounds and unavailable balance is never zero percent',()=>{
 const c=column();c.rows[1]!.bidCoverage='partial';const v=projectOrderBook([c],['binance-spot'],'1',anchor,1100);
 expect(v.rows[1]!.bid.coverage).toBe('lower-bound');expect(displayedBalance(v.rows).complete).toBe(false);
 const offline={...c,state:'disconnected' as const};expect(displayedBalance(projectOrderBook([offline],['binance-spot'],'1',anchor,1100).rows).bidShare).toBeNull();
});
test('cumulative sums require matching cursor/epoch/reference and retain independent source fences',()=>{
 const c=column();c.cumulative={version:1,reference:anchor.price,referenceIndex:'100',cursor:3,epoch:5,at:1000,rows:c.rows.map(r=>({index:r.index,bid:BigInt(r.index)<=100n?{quantity:5,notional:500.1,coverage:'exact'}:null,ask:BigInt(r.index)>=100n?{quantity:4,notional:402.4,coverage:'exact'}:null}))};
 expect(projectOrderBook([c],[c.source],'1',anchor,1100).rows[0]!.bid.cumulative?.notional).toBe(500.1);
 for(const patch of [{cursor:2},{epoch:99},{reference:'100.5'},{at:900},{referenceIndex:'99'}]){
  const wrong={...c,cumulative:{...c.cumulative,...patch}};expect(projectOrderBook([wrong],[c.source],'1',anchor,1100).rows[0]!.bid.cumulative?.coverage).toBe('unknown');
 }
});
test('stack pieces conserve all amounts and widths including Other; labels progressively shorten',()=>{
 const pieces=barPieces(['s','p','tiny','tiny2'],[70,20,1,2],100,10,100,3);
 expect(pieces.map(p=>p.id)).toEqual(['s','p',null]);expect(pieces.reduce((s,p)=>s+p.notional,0)).toBe(93);expect(pieces.reduce((s,p)=>s+p.width,0)).toBe(93);
 expect(pieces[2]!.merged).toEqual([{id:'tiny',notional:1},{id:'tiny2',notional:2}]);
 const measure=(s:string)=>s.length*6;expect(pieceLabel('Binance Spot','BIN-S','2m',120,measure)).toBe('Binance Spot 2m');expect(pieceLabel('Binance Spot','BIN-S','2m',60,measure)).toBe('BIN-S 2m');expect(pieceLabel('Binance Spot','BIN-S','2m',36,measure)).toBe('BIN-S');expect(pieceLabel('Binance Spot','BIN-S','2m',20,measure)).toBeNull();
 const cache=new TextMeasurements();let calls=0;const size=()=>{calls++;return 10;};cache.measure('10px','abc',size);cache.measure('10px','abc',size);expect(calls).toBe(1);for(let i=0;i<600;i++)cache.measure('10px',String(i),size);expect(cache.size).toBe(512);
});
test('line ranking is held 30 seconds and resets when live membership changes',()=>{
 const r=new LiquidityRanking();expect(r.apply(0,['s','p'],1,id=>id==='s'?100:1)).toEqual(['s']);expect(r.apply(1000,['s','p'],1,id=>id==='p'?100:1)).toEqual(['s']);expect(r.apply(30000,['s','p'],1,id=>id==='p'?100:1)).toEqual(['p']);expect(r.apply(30001,['s'],1,()=>10)).toEqual(['s']);
});
const legacy={grid:{},panels:{'depth-matrix-old':{id:'depth-matrix-old',contentComponent:'depth-matrix',title:'Depth Matrix',params:{sources:['binance-perpetual','binance-spot'],referenceSourceId:'binance-perpetual',columnWidth:130,unit:'usdt',scale:'shared',wallMode:'absolute',wallThreshold:7,bucketWidth:'250',viewport:{low:'80000',high:'120000'},priceAnchor:{price:'85000',offset:3}}}}};
test('legacy migration keeps identity, dock geometry, single preferences and viewport; repeat is idempotent',()=>{
 const migrated=restoreValue(JSON.stringify({version:9,layout:legacy}))!;expect(migrated.panels['depth-matrix-old']).toMatchObject({id:'depth-matrix-old',contentComponent:'order-book',title:'Order Book',params:{mode:'single',orderBookVersion:1,...legacy.panels['depth-matrix-old'].params}});
 expect(restoreValue(JSON.stringify({version:10,layout:migrated}))).toEqual(migrated);expect(migrated.grid).toEqual(legacy.grid);
 const settings=orderBookSettings(migrated.panels['depth-matrix-old']!.params);expect(orderBookSettings(serializeOrderBookSettings({...settings,mode:'compact',compact:{show:'levels',venueLines:0}}))).toMatchObject({columnWidth:130,unit:'usdt',scale:'shared',compact:{show:'levels',venueLines:0}});
 expect(orderBookSettings(undefined).mode).toBe('compact');
});
test('inactive workspaces and imported/duplicated layouts migrate once without duplicate panels',()=>{
 const active=newWorkspace('active'),inactive={...newWorkspace('inactive'),layout:legacy};
 const registry=parseRegistry(JSON.stringify({version:1,revision:0,activeId:active.id,workspaces:[active,inactive]}));
 expect(Object.keys(registry.workspaces[1]!.layout.panels)).toEqual(['depth-matrix-old']);expect(registry.workspaces[1]!.layout.panels['depth-matrix-old']!.contentComponent).toBe('order-book');
 expect(parseRegistry(JSON.stringify(registry))).toEqual(registry);
 const copy=duplicateWorkspace(registry.workspaces[1]!,'copy');expect(Object.values(copy.layout.panels)).toHaveLength(1);expect(Object.values(copy.layout.panels)[0]!.contentComponent).toBe('order-book');expect(Object.keys(copy.layout.panels)[0]).not.toBe('depth-matrix-old');
});

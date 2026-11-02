import { expect,it } from 'vitest';
import { freezeSnapshot, type SnapshotInput } from '../src/journal/snapshot';
import { snapshotLayers } from '../src/journal/coverage';
import { config } from '../src/panel';
import { journalTime } from './helpers/journal';
it('freezes the completed in-memory document, current composition and pane identities without storage or workspace state',()=>{
  const settings=config({venue:'binance',market:'perpetual',interval:'1m'}),drawing={version:2,drawings:[{id:'zone',tool:'rectangle',points:[{time:journalTime/1000,price:10}],style:{color:'blue'}}]},tree={version:1,revision:0,entries:[]},state={panes:[],series:[],alerts:[{apiKey:'excluded'}]};
  const snapshot=freezeSnapshot({config:settings,drawings:{toJSON:()=>drawing},objectTree:tree,chart:{panes:()=>[{}],primaryPaneIndex:()=>0,getState:()=>state,getVisibleLogicalRange:()=>({from:0,to:1}),dataLayer:{indexToTimeFloat:(index:number)=>journalTime/1000+index*60}},paneForInstance:()=>0,layers:[],dataAsOf:journalTime,display:{timezone:'UTC',theme:'dark',currency:{}},candleState:{count:2,firstTime:journalTime,last:{t:journalTime,closed:false}}} as unknown as SnapshotInput,journalTime);
  drawing.drawings[0]!.style.color='red';settings.footprint.cellStyle='ladder';tree.revision++;expect(snapshot.drawings).toMatchObject({drawings:[{style:{color:'blue'}}]});expect(snapshot.objectTree.revision).toBe(0);expect(snapshot.nativeState).not.toHaveProperty('alerts');expect(snapshot.panes[0]).toMatchObject({id:'price',primary:true});expect(snapshot.visibleRange).toEqual({from:journalTime,to:journalTime+60000});expect(snapshot.engine).toBe('2.6.0');expect(Object.isFrozen(snapshot.config.composition)).toBe(true);
});
it('records unknown order-flow coverage explicitly and never infers executions from candles',()=>{
  const candle={t:journalTime,o:100,h:110,l:90,c:105,v:10,closed:false,revision:1};const layers=snapshotLayers({venue:'binance',market:'perpetual',interval:'1m'},[candle],{series:{type:'footprint'},status:{lastUpdate:journalTime+2000,state:'live'},footprint:{status:{coverage:'partial'}},heatmap:{status:{state:'live',collectionStart:journalTime,lastUpdate:journalTime+1000}}});expect(layers[0]).toMatchObject({from:journalTime,to:journalTime+60000,dataAsOf:journalTime+2000});expect(layers[1]).toMatchObject({from:null,to:null,dataAsOf:null,quality:'partial'});expect(layers[2]).toMatchObject({layer:'resting order book',from:journalTime});
});

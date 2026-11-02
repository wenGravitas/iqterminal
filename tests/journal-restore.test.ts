import { describe, expect, it } from 'vitest';
import { prepareRestore } from '../src/journal/restore';
import { nativeInstance, COMPOSITION_SMA_ID } from '../src/indicators/model';
import { CVD_ID } from '../src/feed/cvd';
import { compositionPaneId, numericOutputId, numericOutputScaleId } from '../src/scripts/composition';
import { journalSnapshot } from './helpers/journal';
import type { ChartSnapshot } from '../src/journal/model';
import type { ScriptLibrary } from '../src/scripts/library';
describe('safe saved-chart preparation',()=>{
  it('remaps native instance, pane and output identities while retaining definitions and original anchors',async()=>{
    const base=journalSnapshot(),cvd=nativeInstance(CVD_ID,{}),pane=compositionPaneId(cvd.instanceId),scale=numericOutputScaleId(pane,'','BTC');cvd.paneId=pane;
    const sma=nativeInstance(COMPOSITION_SMA_ID,{length:20},true,{instanceId:'sma',placement:'pane',paneId:pane,numericInputs:{source:{version:1,kind:'indicator-output',instanceId:cvd.instanceId,outputId:numericOutputId(cvd.instanceId,'cvdTotalBtc'),plotKey:'cvdTotalBtc',schemaId:'number:chart-candles-v1:cvdTotalBtc:BTC:1',unit:'BTC',domain:'chart-candles-v1',contextId:'binance:perpetual:BTCUSDT'}},plotScaleIds:{p0:scale}});sma.visible=true;
    const snapshot={...base,config:{...base.config,indicators:[cvd,sma],composition:{version:1,panes:[{id:pane,title:'Flow',memberIds:[cvd.instanceId,sma.instanceId],weight:.3,collapsed:false}],embeddedBands:[],scales:[],plots:[],opaqueLegacyPanes:[]}},panes:[...base.panes,{id:pane,capturedIndex:1,primary:false,members:[cvd.instanceId,sma.instanceId]}],drawings:{version:2,drawings:[{id:'zone',tool:'rectangle',paneIndex:0,points:[{time:1800000000,price:100},{time:1800000060,price:110}],style:{fill:true,extendRight:true}}],groups:[]},objectTree:{version:1,revision:0,entries:[{type:'folder',id:'folder',name:'Zones',children:[{type:'drawing',drawingId:'zone'},{type:'indicator',indicatorId:cvd.instanceId}]}]}} as ChartSnapshot;
    const restored=await prepareRestore(snapshot,{getRevision:async()=>null} as unknown as ScriptLibrary);expect(restored.config.indicators[0]!.definitionId).toBe(CVD_ID);expect(restored.config.indicators[0]!.instanceId).not.toBe(cvd.instanceId);expect(restored.config.indicators[1]!.numericInputs?.source.instanceId).toBe(restored.config.indicators[0]!.instanceId);expect(restored.drawings.drawings).toMatchObject([{points:snapshot.drawings.drawings instanceof Array?snapshot.drawings.drawings[0].points:[]}]);expect(JSON.stringify(snapshot)).toContain('"drawingId":"zone"');expect(restored.config.indicators[1]!.plotScaleIds?.p0).not.toBe(scale);
  });
  it('never substitutes a market or executes archived script source when the exact local hash is absent',async()=>{
    const base=journalSnapshot();await expect(prepareRestore({...base,market:{venue:'binance',market:'spot',symbol:'ETHUSDT'}},{getRevision:async()=>null} as unknown as ScriptLibrary)).rejects.toThrow(/No substitute/);
    const instance={instanceId:'script-one',definitionId:'script:test',settingsVersion:1,visible:true,source:{kind:'chart'},placement:'pane',settings:{},script:{scriptId:'test',revisionId:'a'.repeat(64),title:'Archived',description:''}};
    const snapshot={...base,config:{...base.config,indicators:[instance]},scripts:[{instanceId:'script-one',scriptId:'test',revisionId:'a'.repeat(64),contentHash:'b'.repeat(64),source:'untrusted code'}]} as ChartSnapshot;
    const restored=await prepareRestore(snapshot,{getRevision:async()=>null} as unknown as ScriptLibrary);expect(restored.config.indicators[0]).toMatchObject({visible:false,source:{kind:'journal-unavailable'}});expect(restored.warnings.join(' ')).toContain('not executed');
  });
});

import {test,expect} from 'vitest';
import {startupLayout,startupSelection} from '../src/feed/startup-selection';
import {restoreFeedPlan} from '../src/feed/restore-bootstrap';
import {config} from '../src/panel';
import {nativeInstance,FOOTPRINT_ID,FOOTPRINT_TOTALS_ID,ORDER_WALLS_ID} from '../src/indicators/model';
import {newWorkspace,WORKSPACE_KEY} from '../src/workspaces/model';
const layout=(params:any,id='chart-startup')=>({panels:{[id]:{id,contentComponent:'candle',params}},grid:{root:{type:'leaf',data:{views:[id],activeView:id}}}}) as any;
const base={venue:'binance',market:'perpetual',interval:'1h',type:'footprint'};
test('early sources match full chart configuration for legacy and persisted native settings',()=>{
 const cases:any[]=[];
 for(const market of ['spot','perpetual'])for(const rowPrice of [undefined,25,37.5,.1,0,NaN])for(const type of ['candle','footprint']){
  const raw={...base,market,type,...(rowPrice===undefined?{}:{rowPrice})};cases.push(raw,config(raw));
  cases.push({...raw,indicators:[nativeInstance(FOOTPRINT_TOTALS_ID,{})]});
  cases.push({...raw,indicators:[nativeInstance(FOOTPRINT_ID,{rowPrice:37.5},false),nativeInstance(FOOTPRINT_TOTALS_ID,{})]});
 }
 cases.push({...base,rowTicks:20},{...base,rowTicks:10},{...base,indicators:[]});
 for(const visible of [true,false])for(const settingsVersion of [1,2,99])cases.push({...base,indicators:[{...nativeInstance(FOOTPRINT_ID,{rowPrice:50},visible),settingsVersion}]});
 for(const mode of ['top-levels','threshold'])cases.push({...base,indicators:[nativeInstance(ORDER_WALLS_ID,{mode,enabled:true}),nativeInstance(FOOTPRINT_TOTALS_ID,{})]});
 for(const raw of cases)expect(restoreFeedPlan(layout(raw),startupSelection),JSON.stringify(raw)).toBe(restoreFeedPlan(layout(raw),config));
});
test('early sources honor authoritative removals, singleton order, invalid records and source kinds',()=>{
 const a=nativeInstance(FOOTPRINT_ID,{rowPrice:25}),b=nativeInstance(FOOTPRINT_ID,{rowPrice:50},true,{instanceId:'footprint-other'});
 for(const indicators of [[],[a,b],[{...a,visible:false},b],[{...a,settingsVersion:99},b],[{...a,source:{kind:'other'}},b],[{...a,settings:[]},b],[{...a,settings:undefined},b],[{...a,instanceId:''},b]]){
  const raw={...base,indicators};expect(restoreFeedPlan(layout(raw),startupSelection)).toBe(restoreFeedPlan(layout(raw),config));
 }
});
test('startup layout follows registry active/fallback order without writing or altering stored records',()=>{
 const a=newWorkspace('First',layout(base)),b=newWorkspace('Second',layout({...base,market:'spot'},'chart-second'));
 const raw=JSON.stringify({version:1,revision:1,activeId:b.id,workspaces:[a,b]});const values=new Map([[WORKSPACE_KEY,raw]]),storage={getItem:(key:string)=>values.get(key)??null};
 expect(startupLayout(storage)).toEqual(b.layout);expect(values.get(WORKSPACE_KEY)).toBe(raw);
 b.layout={} as any;values.set(WORKSPACE_KEY,JSON.stringify({version:1,revision:2,activeId:b.id,workspaces:[a,b]}));expect(startupLayout(storage)).toEqual(a.layout);
 values.set(WORKSPACE_KEY,'{invalid');values.set('basis.layout.v1',JSON.stringify({version:5,layout:a.layout}));expect(startupLayout(storage)).toEqual(a.layout);
 expect(startupLayout({getItem:()=>{throw Error('blocked storage');}})).toBeNull();
});

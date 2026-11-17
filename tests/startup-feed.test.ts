import {test,expect,vi,beforeEach,afterEach} from 'vitest';
const state=vi.hoisted(()=>({instances:[] as any[]}));
vi.mock('../src/feed/client',()=>({FeedClient:class {
 calls:any[]=[];released=0;disposed=0;constructor(...args:any[]){state.instances.push(this);this.calls.push(['constructor',...args]);}
 subscribe(...args:any[]){this.calls.push(['native',...args]);return()=>this.released++;}
 subscribeFootprint(...args:any[]){this.calls.push(['footprint',...args]);return()=>this.released++;}
 subscribeOrderWalls(...args:any[]){this.calls.push(['walls',...args]);return()=>this.released++;}
 requestFootprintViewport(...args:any[]){this.calls.push(['viewport',...args]);}
 dispose(){this.disposed++;}
}}));
const params={venue:'binance',market:'perpetual',interval:'1h',type:'footprint',rowPrice:25};
const layout=(patch:any={})=>({panels:{'chart-early':{id:'chart-early',contentComponent:'candle',params:{...params,...patch}}},grid:{root:{type:'leaf',data:{views:['chart-early'],activeView:'chart-early'}}}}) as any;
beforeEach(()=>{
 vi.resetModules();state.instances.length=0;vi.stubEnv('VITE_DATA_MODE','staging');vi.stubGlobal('location',{href:'http://127.0.0.1:4181/'});
 vi.stubGlobal('localStorage',{getItem:(key:string)=>key==='basis.layout.v1'?JSON.stringify({version:5,layout:layout()}):null});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
test('entry and UI share one client; released ownership does not reuse a disposed client on HMR',async()=>{
 const startup=await import('../src/feed/startup');const early=startup.prepareStartupFeed(),taken=startup.takeStartupFeed();
 expect(taken).toBe(early);expect(state.instances).toHaveLength(1);expect(state.instances[0].calls.map((c:any[])=>c[0])).toEqual(['constructor','native','footprint','viewport']);
 taken.release();taken.release();expect(state.instances[0].released).toBe(2);taken.feed.dispose();
 const next=startup.takeStartupFeed();expect(next.feed).not.toBe(taken.feed);expect(state.instances).toHaveLength(2);startup.discardStartupFeed(next);
});
test('changed or rejected restore candidates release obsolete reads before the UI joins its source',async()=>{
 const startup=await import('../src/feed/startup'),selection=await import('../src/feed/startup-selection');
 const early=startup.takeStartupFeed(),instance=state.instances[0];early.reconcile(layout(),selection.startupSelection);expect(instance.released).toBe(0);
 early.reconcile(layout({market:'spot'}),selection.startupSelection);expect(instance.released).toBe(2);expect(instance.disposed).toBe(0);
 early.release();expect(instance.released).toBe(2);startup.discardStartupFeed(early);
});
test('failed UI import disposes pending reads and leaves a fresh future handoff',async()=>{
 const startup=await import('../src/feed/startup'),early=startup.prepareStartupFeed();startup.discardStartupFeed(early);
 expect(state.instances[0].disposed).toBe(1);expect(state.instances[0].released).toBe(2);
 const next=startup.takeStartupFeed();expect(next.feed).not.toBe(early.feed);startup.discardStartupFeed(next);
});
test('explicit fixture and direct modes do not preload private staging sources',async()=>{
 vi.stubGlobal('location',{href:'http://127.0.0.1:4181/?fixture=1'});
 let startup=await import('../src/feed/startup'),early=startup.takeStartupFeed();expect(state.instances[0].calls).toEqual([['constructor',true,false]]);startup.discardStartupFeed(early);
 vi.resetModules();vi.stubEnv('VITE_DATA_MODE','direct');vi.stubGlobal('location',{href:'http://127.0.0.1:4181/'});
 startup=await import('../src/feed/startup');early=startup.takeStartupFeed();expect(state.instances.at(-1).calls).toEqual([['constructor',false,false]]);startup.discardStartupFeed(early);
});

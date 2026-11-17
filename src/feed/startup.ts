import {FeedClient} from './client';
import {startupLayout,startupSelection} from './startup-selection';
import {restoreFeedPlan,startVisibleChartFeeds} from './restore-bootstrap';
import type {SerializedDockview} from 'dockview-core';
import type {RestoreFeedSelection} from './restore-bootstrap';
const query=new URL(location.href).searchParams;
export const fixtureSelected=(import.meta.env.DEV||import.meta.env.VITE_DIAGNOSTICS==='1')&&query.get('fixture')==='1';
const create=()=>new FeedClient(fixtureSelected,fixtureSelected&&query.get('fixtureTime')==='now');
interface Startup {feed:FeedClient;release:()=>void;reconcile:(layout:SerializedDockview,normalize:(raw:unknown)=>RestoreFeedSelection)=>void}
let pending:Startup|undefined;
export function prepareStartupFeed(){
 if(pending)return pending;
 const feed=create();let release=()=>{},plan:string|undefined;
 if(import.meta.env.VITE_DATA_MODE==='staging'&&!fixtureSelected)try{
  const layout=startupLayout(localStorage);
  if(layout){plan=restoreFeedPlan(layout,startupSelection);release=startVisibleChartFeeds(feed,layout,startupSelection,true);}
 }catch{/* Full UI owns storage/configuration recovery. */}
 let released=false,verifiedLayout:string|undefined;
 const cleanup=()=>{if(released)return;released=true;release();};
 const startup:Startup={feed,release:cleanup,reconcile:(layout,normalize)=>{if(released)return;try{const key=JSON.stringify(layout);if(key===verifiedLayout)return;if(plan!==undefined&&restoreFeedPlan(layout,normalize)!==plan)cleanup();verifiedLayout=key;}catch{cleanup();}}};
 pending=startup;return startup;
}
/** A one-time ownership transfer also keeps UI HMR from reusing a disposed client. */
export function takeStartupFeed(){const startup=pending??prepareStartupFeed();pending=undefined;return startup;}

export function discardStartupFeed(startup:Startup){if(pending===startup)pending=undefined;startup.release();startup.feed.dispose();}

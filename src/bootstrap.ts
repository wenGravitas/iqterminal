import {prepareStartupFeed,discardStartupFeed} from './feed/startup';
// Fetch/evaluate the UI while the same worker restores saved visible sources.
const startup=prepareStartupFeed();
void import('./main').catch(error=>{
 discardStartupFeed(startup);
 window.dispatchEvent(new ErrorEvent('error',{error,message:error instanceof Error?error.message:String(error)}));
});

import {test,expect} from '@playwright/test';
import {projectionOnlyFixture,from,settings} from '../helpers/prepared-wall-fixture';
test.use({headless:true,launchOptions:{executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--name=IQTerminalPerf','--ozone-platform=headless','--no-sandbox']}});
test('archived range navigation retains Canvas walls and reopens cached native shards with body origin offline',async({page})=>{
 test.setTimeout(60000);const day=86400000,fixtures=[projectionOnlyFixture(false,from+day,from),projectionOnlyFixture(false,from+2*day,from+day)].map(f=>({request:{market:'spot',profile:f.source.profile,from:f.context.from,to:f.context.to},discovery:f.discovery,manifest:f.manifest,source:f.source,texts:f.texts}));
 await page.goto('/tests/browser/fixtures/wall-archive-ranges.html');
 const result=await page.evaluate(async({fixtures,settings})=>(window as any).runArchivedWallRanges(fixtures,settings),{fixtures,settings});
 expect(result.blankFrames).toBe(0);expect(result.removedDuringLoad).toBe(0);expect(result.panAddedRequests).toBe(0);expect(result.initialDownloads).toBe(2);expect(result.finalDownloads).toBe(2);expect(result.cachedReopenMs).toHaveLength(5);expect(result.exactQuantities).toContain('3.000000000003');expect(result.coverage).toMatchObject({requestComplete:true,rangeComplete:false});
 console.log(JSON.stringify({kind:'archived-wall-range-browser-fixture',...result}));
});

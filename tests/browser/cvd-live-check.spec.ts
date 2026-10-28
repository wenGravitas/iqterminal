import { test, expect } from '@playwright/test';
import { addIndicator } from './indicator-actions';

test('recorded CVD serves both markets and advances in the rendered client', async ({page}) => {
  test.skip(process.env.IQ_CVD_LIVE_TEST !== '1', 'Explicit live staging verification only');
  test.setTimeout(180_000);
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/');
  await expect.poll(()=>page.evaluate(()=>(window as any).__terminal?.stats().panels[0]?.bars??0),{timeout:90000}).toBeGreaterThan(0);
  const panel=page.locator('.candle-panel').first();
  await addIndicator(panel,'Multi-Venue CVD');
  const diagnostics=()=>page.evaluate(()=>[...(window as any).__terminal.panels.values()][0].cvdView?.diagnostics());
  await expect.poll(async()=>(await diagnostics())?.sources.filter((s:any)=>s.points>0).length,{timeout:90000}).toBe(2);
  await expect.poll(async()=>(await diagnostics())?.segments??0,{timeout:30000}).toBeGreaterThan(0);
  const initial=await diagnostics();
  await expect.poll(async()=>{
    const current=await diagnostics();
    return current.sources.every((s:any)=>s.asOf>initial.sources.find((old:any)=>old.source===s.source).asOf);
  },{timeout:30000}).toBe(true);
  const result=await diagnostics();
  await panel.screenshot({path:'/tmp/iqterminal-cvd-live.png'});
  console.log(JSON.stringify({sources:result.sources.map((s:any)=>({source:s.source,points:s.points,status:s.status,asOf:s.asOf,message:s.message,latest:s.latest})),coverage:result.coverage,segments:result.segments,errors}));
  expect(errors).toEqual([]);
});

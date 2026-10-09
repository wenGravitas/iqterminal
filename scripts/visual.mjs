import {launch,url} from './browser.mjs';
const browser=await launch();const page=await browser.newPage();page.on('pageerror',e=>console.error(e));await page.goto(url+'/?fixture=1');await page.waitForFunction(()=>window.__terminal?.stats().panels.every(p=>p.bars===5000));
for(const [width,height] of [[1920,1080],[1366,768]]){await page.setViewportSize({width,height});await page.waitForTimeout(300);await page.screenshot({path:`artifacts/terminal-${width}x${height}.png`});}
console.log(JSON.stringify(await page.evaluate(()=>({stats:window.__terminal.stats(),style:getComputedStyle(document.querySelector('.dv-tabs-and-actions-container')).height})),null,2));await browser.close();

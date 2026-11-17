import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {verifyHeadedBrowser} from './test-browser-i3-setup.mjs';
const label=process.argv[2];if(!label||!/^[-a-z0-9]+$/.test(label))throw Error('Supply a unique evidence label');
verifyHeadedBrowser({headless:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:1280,height:720}});await page.goto('http://127.0.0.1:4189/tests/browser/fixtures/wall-navigation.html');await page.waitForFunction(()=>typeof window.runWallNavigation==='function');for(const retained of [false,true]){const result=await page.evaluate(retained=>window.runWallNavigation(retained),retained);await writeFile(`artifacts/persistent-wall-navigation/${label}-${retained?'retained':'baseline'}.json`,JSON.stringify(result,null,2),{flag:'wx'});const t=[...result.times].sort((a,b)=>a-b);console.log(JSON.stringify({retained,initial:result.initial,blank:result.blankFrames,p95:t[Math.floor(t.length*.95)],max:Math.max(...t),resources:result.after.retainedRenderer}));}}finally{await browser.close();}

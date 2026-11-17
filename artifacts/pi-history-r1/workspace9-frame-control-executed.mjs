/** Explicit offline display-scheduler control; no chart/source/FPS acceptance. */
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {routeTestBrowser} from './test-browser-workspace.mjs';
const focused=()=>JSON.parse(execFileSync('i3-msg',['-t','get_workspaces'],{encoding:'utf8'})).find(w=>w.focused)?.num;
const before=focused(),samples=[];
const browser=await chromium.launch({headless:false,executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--no-sandbox','--use-angle=gles']});
try{
 for(let run=1;run<=3;run++){
  const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage();await routeTestBrowser();
  await page.setContent('<title>IQTerminal offline frame control</title><canvas width="1920" height="1080"></canvas>');
  await page.evaluate(()=>{
   const ctx=document.querySelector('canvas').getContext('2d');let last=performance.now();window.__frames=[];window.__paint=[];
   window.__reset=()=>{window.__frames=[];window.__paint=[];last=performance.now();};
   const frame=now=>{window.__frames.push(now-last);last=now;const start=performance.now();ctx.fillStyle='#080808';ctx.fillRect(0,0,1920,1080);ctx.strokeStyle='#287b67';ctx.beginPath();for(let i=0;i<360;i++){ctx.moveTo(i*5,200);ctx.lineTo(i*5,800);}ctx.stroke();window.__paint.push(performance.now()-start);requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  const measure=()=>page.evaluate(async()=>{const start=performance.now();await new Promise(r=>setTimeout(r,4000));const frames=window.__frames.slice(),paint=window.__paint.slice();return {elapsed:performance.now()-start,visibility:document.visibilityState,focused:document.hasFocus(),frames,paint};});
  const unfocused=await measure();await page.bringToFront();await routeTestBrowser();const activationWorkspace=focused();
  if(activationWorkspace!==before)throw Error('Workspace changed during display control; refusing further activations');
  await page.evaluate(()=>window.__reset());const internallyActivated=await measure();
  samples.push({run,workspaceBefore:before,workspaceAfter:focused(),unfocused,internallyActivated});await context.close();
 }
}finally{await browser.close();writeFileSync('artifacts/pi-history-r1/workspace9-frame-control.json',JSON.stringify({scope:'Offline Canvas2D scheduling control, not chart/source/FPS acceptance',browser:browser.version(),before,after:focused(),samples},null,2));}
for(const sample of samples)for(const mode of ['unfocused','internallyActivated']){const f=sample[mode].frames.slice().sort((a,b)=>a-b);console.log(JSON.stringify({run:sample.run,mode,frames:f.length,median:f[Math.floor(f.length/2)],max:Math.max(...f),elapsed:sample[mode].elapsed,workspace:sample.workspaceAfter}));}

import{chromium}from'../../../scripts/test-browser-launch.mjs';import{readFileSync,writeFileSync}from'node:fs';
if(process.env.IQ_HISTORY_ERROR_UI_CHECK!=='1')throw Error('Explicit history HTTP fault injection required');
const base='http://127.0.0.1:4191',dir='artifacts/pi-history-r1/discovery-diagnosis-r2',expected='e12965d38f9dc584c8fdfe46b8817a249166259a';
const ref=JSON.parse(readFileSync('artifacts/pi-history-r1/side-client-r1/references.json')).cases['walls-30h-perp-15m'];
const params={venue:'binance',market:'perpetual',interval:'15m',type:'candle',rowPrice:25,historyViewport:{from:ref.from,to:ref.to},studies:[],indicators:[{instanceId:'native.order-walls',definitionId:'native.order-walls',settingsVersion:2,visible:true,source:{kind:'chart'},placement:'overlay',settings:{enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10,aggregation:'native',minDurationMs:0,showHistory:true}}]};
const layout={grid:{root:{type:'branch',data:[{type:'leaf',data:{views:['chart-bench'],activeView:'chart-bench',id:'1'},size:1920}],size:1080},width:1920,height:1080,orientation:'HORIZONTAL'},panels:{'chart-bench':{id:'chart-bench',contentComponent:'candle',tabComponent:'compact-chart',title:'Candles',params,minimumHeight:140,minimumWidth:220}},activeGroup:'1'};
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=gles']});let context,faults=0,record={scope:'Explicit mocked discovery503 over actual staging native candles; headless UI/status check only, not latency, financial-wall coverage or current ACK acceptance',expectedBuild:expected};
try{
 context=await browser.newContext({viewport:{width:1920,height:1080},storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'basis.layout.v1',value:JSON.stringify({version:5,layout})},{name:'basis.theme.v1',value:'dark'}]}]}});
 await context.route('**/v2/history/walls/discover?*',route=>{faults++;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Diagnostic source query budget exceeded'})});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__terminal?.panels.get('chart-bench')?.orderWallsStatus?.message?.includes('Diagnostic source query budget exceeded'),null,{timeout:15000});
 await page.waitForFunction(()=>window.__terminal?.panels.get('chart-bench')?.candles.length>0,null,{timeout:30000});
 await page.evaluate(()=>window.__terminal.feed.send({type:'diagnostics'}));
 await page.waitForFunction(()=>window.__terminal?.feed.diagnostics?.staging?.config?.build,null,{timeout:5000});
 record={...record,faults,errors,...await page.evaluate(()=>{const p=window.__terminal.panels.get('chart-bench');return{status:p.orderWallsStatus,nativeStatus:p.status,nativeCandles:p.candles.length,notice:document.querySelector('.order-walls-notice')?.textContent,diagnostics:window.__terminal.feed.diagnostics};})};
 if(record.diagnostics.fixture!==false||record.diagnostics.staging.config.build!==expected||!record.notice?.includes('Diagnostic source query budget exceeded')||errors.length)throw Error('UI/build verification failed');
 await page.screenshot({path:dir+'/specific-history-error.png'});record.pass=true;
}catch(error){record.pass=false;record.error=String(error);record.faults=faults;const page=context?.pages()[0];record.failureSnapshot=await page?.evaluate(()=>({panels:[...window.__terminal?.panels?.keys()??[]],status:window.__terminal?.panels.get('chart-bench')?.orderWallsStatus,text:document.body.innerText.slice(-5000),diagnostics:window.__terminal?.feed.diagnostics})).catch(()=>null);await page?.screenshot({path:dir+'/failure-ui.png'}).catch(()=>{});throw error;}
finally{writeFileSync(dir+'/error-ui.json',JSON.stringify(record,null,2)+'\n');await context?.close();await browser.close();}

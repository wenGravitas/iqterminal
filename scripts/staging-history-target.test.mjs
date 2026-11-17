import test from 'node:test';import assert from 'node:assert/strict';import {loadConfigFromFile} from 'vite';
async function configured(env,check){
 const keys=['VITE_HISTORY_API_URL','VITE_NATIVE_HISTORY_API_URL','VITE_LIQUIDATION_API_URL'],prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));let config;
 try{for(const k of keys)delete process.env[k];Object.assign(process.env,env);const loaded=await loadConfigFromFile({command:'serve',mode:'staging'});config=loaded?.config;return await check(config?.server?.proxy);}
 finally{for(const k of keys){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}config?.plugins.find(p=>p.name==='staging-loopback-only')?.api.proxyBudget.close();for(const a of new Set(Object.values(config?.server?.proxy??{}).map(p=>p.agent).filter(Boolean)))a.destroy();}
}
test('default history and current routes retain separate private transports',()=>configured({},p=>{assert.equal(p['/market-data'].target,'http://127.0.0.1:18780');assert.equal(p['/market-data/v1/native-candles'].target,'http://127.0.0.1:18780');assert.equal(p['/market-data/v2/history/health'].target,'http://127.0.0.1:18781');}));
test('isolated history override covers bulk/native without rerouting current or streams',()=>configured({VITE_HISTORY_API_URL:'http://127.0.0.1:18880'},p=>{
 for(const path of ['/market-data','/market-data/v1/native-candles','/market-data/v1/footprints','/market-data/v1/liquidations'])assert.equal(p[path].target,'http://127.0.0.1:18880');
 for(const path of ['/market-data/v2/history/health','/market-data/v2/history/walls/reader','/market-data/v2/history/footprint-current','/market-data/v1/order-walls/archive/current','/market-data/v1/stream'])assert.equal(p[path].target,'http://127.0.0.1:18781');
 assert.notEqual(p['/market-data'].agent,p['/market-data/v2/history/health'].agent);
}));
test('explicit native override remains independent of bulk history override',()=>configured({VITE_HISTORY_API_URL:'http://127.0.0.1:18880',VITE_NATIVE_HISTORY_API_URL:'http://127.0.0.1:18882'},p=>{assert.equal(p['/market-data/v1/native-candles'].target,'http://127.0.0.1:18882');assert.equal(p['/market-data'].target,'http://127.0.0.1:18880');}));
test('history override cannot turn staging proxy into an external or credentialled route',async()=>{
 for(const target of ['https://127.0.0.1:18880','http://example.com','http://user:password@127.0.0.1:18880','http://127.0.0.1:18880/private','http://127.0.0.1:18880/?query','http://127.0.0.1:18880/#fragment'])await assert.rejects(()=>configured({VITE_HISTORY_API_URL:target},()=>{}),/unauthenticated loopback HTTP origin/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {browserWallFinancialProof} from './browser-wall-financial-proof.mjs';
const segment={id:'wall',archiveEntryId:'entry',start:1000,end:null,side:'bid',price:100,priceExact:'100',valueRuns:[{at:1000,quantity:2,quantityExact:'2.000000000001',notionalExact:'200.0000000001',usd:200}]};
function install(row,revision=()=>1){globalThis.window={__terminal:{panels:new Map([['chart-bench',{engine:{orderWallsDiagnostics:()=>({inputRevision:revision()}),orderWallSegments:new Map([[row.id,row]])}}]])}};}
const page={evaluate:fn=>fn()};
test('exact decimals survive proof and only application tags are excluded',async()=>{
 install({...segment,currentSelection:false,presentationKind:undefined});
 try{
  const first=await browserWallFinancialProof(page);
  // Independent fixed canonical JSON, with recursively sorted keys, matches
  // the source reference helper's per-segment digest then ordered union digest.
  const canonical='{"archiveEntryId":"entry","end":null,"id":"wall","price":100,"priceExact":"100","side":"bid","start":1000,"valueRuns":[{"at":1000,"notionalExact":"200.0000000001","quantity":2,"quantityExact":"2.000000000001","usd":200}]}';
  const hash=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(first.financialHash,hash(JSON.stringify([['wall',hash(canonical)]])));
  install({...segment,valueRuns:[{...segment.valueRuns[0],quantityExact:'2.000000000002'}]});
  assert.notEqual((await browserWallFinancialProof(page)).financialHash,first.financialHash);
 }finally{delete globalThis.window;}
});
test('a revision change cannot certify a mixed captured view',async()=>{
 let revision=0;install(segment,()=>++revision);
 try{await assert.rejects(browserWallFinancialProof(page),/revision changed/);}finally{delete globalThis.window;}
});

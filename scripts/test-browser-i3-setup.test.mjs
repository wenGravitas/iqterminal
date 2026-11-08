import test from 'node:test';
import assert from 'node:assert/strict';
import {testBrowserArgs,verifyHeadedBrowser} from './test-browser-i3-setup.mjs';
test('headless and default launches do not access the desktop',()=>{
 const fail=()=>{throw Error('must not read desktop state');};
 verifyHeadedBrowser({headless:true},{},fail);
 verifyHeadedBrowser({}, {}, fail);
});
test('visible launches are blocked even with the former workspace override',()=>{
 for(const env of [{},{IQ_TEST_HEADED:'workspace9',DISPLAY:':0'}]){
  assert.throws(()=>verifyHeadedBrowser({headless:false,args:testBrowserArgs},env,()=>{throw Error('must not read desktop state');}),/Refusing headed.*run headless/);
 }
});

test('devtools cannot implicitly enable a visible browser',()=>{
 assert.throws(()=>verifyHeadedBrowser({devtools:true}),/Refusing headed/);
 assert.throws(()=>verifyHeadedBrowser({headless:true,devtools:true}),/Refusing headed/);
 assert.ok(testBrowserArgs.includes('--ozone-platform=headless'));
});

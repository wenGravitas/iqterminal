import test from 'node:test';
import assert from 'node:assert/strict';
import {testBrowserArgs,verifyHeadedBrowser} from './test-browser-i3-setup.mjs';
const env={IQ_TEST_HEADED:'workspace9',DISPLAY:':0',I3SOCK:'/test/i3.sock'};
const rules=['assign [instance="^IQTerminalPerf$"] 9','no_focus [instance="^IQTerminalPerf$"]','assign [class="^IQTerminalPerf$"] 9','no_focus [class="^IQTerminalPerf$"]','assign [instance="^chromium \\(/tmp/playwright_"] 9','no_focus [instance="^chromium \\(/tmp/playwright_"]'].join('\n');
test('headed i3 launch requires both pre-map identities and loaded rules',()=>{
 assert.doesNotThrow(()=>verifyHeadedBrowser({headless:false,args:testBrowserArgs},env,()=>rules));
 for(const line of rules.split('\n'))assert.throws(()=>verifyHeadedBrowser({headless:false,args:testBrowserArgs},env,()=>rules.replace(line,'')),/Refusing/);
 for(const missing of testBrowserArgs)assert.throws(()=>verifyHeadedBrowser({headless:false,args:testBrowserArgs.filter(arg=>arg!==missing)},env,()=>rules),/Refusing/);
});
test('headless launch does not query i3',()=>{
 verifyHeadedBrowser({headless:true},env,()=>{throw Error('must not read');});
});

test('headed launch without explicit opt-in fails before reading i3',()=>{
 assert.throws(()=>verifyHeadedBrowser({headless:false,args:testBrowserArgs},{DISPLAY:':0'},()=>{throw Error('must not read');}),/IQ_TEST_HEADED=workspace9/);
});

test('headed launch fails closed without display or readable i3 rules',()=>{
 assert.throws(()=>verifyHeadedBrowser({headless:false,args:testBrowserArgs},{IQ_TEST_HEADED:'workspace9'},()=>rules),/DISPLAY/);
 assert.throws(()=>verifyHeadedBrowser({headless:false,args:testBrowserArgs},{IQ_TEST_HEADED:'workspace9',DISPLAY:':0'},()=>{throw Error('no i3');}),/cannot verify/);
});

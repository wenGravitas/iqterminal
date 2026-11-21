import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('./staging-release-remote-deploy.sh',import.meta.url),'utf8');
const code=source.match(/python3 -c '(import json,sys; c=json.load\(sys.stdin\);[^']+)' "\$https_port"/)[1];
const allowed=(config,port)=>spawnSync('python3',['-c',code,String(port)],{input:JSON.stringify(config)}).status===0;
test('isolated HTTPS publication preserves unrelated Serve ports',()=>{
 assert.equal(allowed({TCP:{8443:{HTTPS:true}},Web:{'host:8443':{Handlers:{}}}},8444),true);
 assert.equal(allowed({},8444),true);
});
test('existing TCP or Web ownership on the requested port fails closed',()=>{
 assert.equal(allowed({TCP:{8444:{HTTPS:true}}},8444),false);
 assert.equal(allowed({Web:{'host:8444':{Handlers:{}}}},8444),false);
 assert.equal(allowed({TCP:[]},8444),false);
});

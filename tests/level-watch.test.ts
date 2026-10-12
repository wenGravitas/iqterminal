import {describe,it,expect,vi,afterEach} from 'vitest';
import {LevelWatchTransport} from '../src/feed/level-watch';
import {FeedClient} from '../src/feed/client';
import type {WatchSnapshot} from '../src/level-watch/types';
class WorkerStub {static latest:WorkerStub;onmessage:((e:{data:unknown})=>void)|null=null;messages:unknown[]=[];constructor(){WorkerStub.latest=this;}postMessage(value:unknown){this.messages.push(value);}terminate(){}receive(data:unknown){this.onmessage?.({data});}}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('Level Watch worker ownership',()=>{
  it('unsupported mode reports unavailable without network fallback',()=>{const emit=vi.fn(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);const transport=new LevelWatchTransport(emit,()=>false);transport.command({type:'watch-start'});transport.command({type:'watch-rpc',id:1,path:'',key:'fixture'});expect(fetch).not.toHaveBeenCalled();expect(emit.mock.calls[0][0].error).toContain('staging');expect(emit.mock.calls[1][0].type).toBe('watch-result');});
  it('shares one stream, routes RPC separately, ACKs even if subscriber throws',async()=>{vi.stubGlobal('Worker',WorkerStub);vi.spyOn(console,'error').mockImplementation(()=>{});const client=new FeedClient();client.subscribeWatches(()=>{throw new Error('UI failure');});const listener=vi.fn();const release=client.subscribeWatches(listener);expect(WorkerStub.latest.messages.filter((m:any)=>m.type==='watch-start')).toHaveLength(1);
    const snapshot={version:1,cursor:7,watches:[],events:[]} as unknown as WatchSnapshot;WorkerStub.latest.receive({type:'watch-state',snapshot});expect(listener).toHaveBeenCalledWith(snapshot,undefined);expect(WorkerStub.latest.messages.at(-1)).toEqual({type:'watch-ack',cursor:7});
    const request=client.watchRequest('/encounters',undefined,'fixture-idempotency');const rpc=WorkerStub.latest.messages.at(-1) as {id:number};WorkerStub.latest.receive({type:'watch-result',id:rpc.id,value:{encounters:[]}});await expect(request).resolves.toEqual({encounters:[]});release();client.dispose();
  });
  it('bounds outstanding requests and rejects them on disposal',async()=>{vi.stubGlobal('Worker',WorkerStub);const client=new FeedClient();const requests=Array.from({length:8},()=>client.watchRequest('',undefined,'fixture'));const rejected=requests.map(p=>expect(p).rejects.toThrow('disposed'));await expect(client.watchRequest('',undefined,'fixture')).rejects.toThrow('capacity');client.dispose();await Promise.all(rejected);});
});

import {replayGeometry} from '../src/level-watch/replay-plot';
it('replay hides future prices and never draws a line across unavailable observations',()=>{
 const zone={name:'Fixture',lower:100,upper:101,invalidation:99,thesis:'',expiresAt:10000};
 const rows=[{at:1,priceTime:1,price:100,health:{state:'ready'}},{at:2,priceTime:2,price:100.5,health:{state:'gap'}},{at:3,priceTime:3,price:101,health:{state:'ready'}},{at:4,priceTime:4,price:900,health:{state:'ready'}}];
 const geometry=replayGeometry(rows,zone,3);expect(geometry.path.match(/M/g)).toHaveLength(2);expect(geometry.path).not.toContain('L');expect(geometry.to).toBe(3);expect(geometry).toEqual(replayGeometry(rows.slice(0,3),zone));
});

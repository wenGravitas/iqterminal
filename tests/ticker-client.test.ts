import { it, expect, vi, afterEach } from 'vitest';
import { FeedClient } from '../src/feed/client';
import { tickerConfig } from '../src/ticker/model';
class WorkerMock { static instance:WorkerMock;messages:any[]=[];onmessage:((e:any)=>void)|null=null;constructor(){WorkerMock.instance=this;}postMessage(c:any){this.messages.push(c);}terminate(){} }
afterEach(()=>vi.unstubAllGlobals());
it('rejects stale ticker configuration results and closed subscriptions, acknowledging each bounded batch',()=>{
  vi.stubGlobal('Worker',WorkerMock);const feed=new FeedClient(),callback=vi.fn(),release=feed.subscribeTicker('one',tickerConfig({}),callback),w=WorkerMock.instance;
  const command=w.messages.at(-1),batch={type:'ticker-batch',ids:[command.id],configRevision:0,generation:1,batchId:1,records:[],status:{state:'live',message:'live',lastUpdate:Date.now()},dropped:0};
  w.onmessage!({data:batch});expect(callback).toHaveBeenCalledTimes(1);feed.updateTicker('one',tickerConfig({scope:[]}));w.onmessage!({data:{...batch,batchId:2}});expect(callback).toHaveBeenCalledTimes(1);w.onmessage!({data:{...batch,configRevision:1,batchId:3}});expect(callback).toHaveBeenCalledTimes(2);release();w.onmessage!({data:{...batch,configRevision:1,batchId:4}});expect(callback).toHaveBeenCalledTimes(2);expect(w.messages.filter(c=>c.type==='ticker-ack')).toHaveLength(4);expect(w.messages.filter(c=>c.type==='ticker-unsubscribe')).toHaveLength(1);feed.dispose();
});
it('replacing a logical ticker subscription releases the old token without erasing the replacement',()=>{
  vi.stubGlobal('Worker',WorkerMock);const feed=new FeedClient(),first=vi.fn(),second=vi.fn();const oldRelease=feed.subscribeTicker('one',tickerConfig({}),first),w=WorkerMock.instance,oldId=w.messages.at(-1).id;feed.subscribeTicker('one',tickerConfig({}),second);const newId=w.messages.at(-1).id;expect(w.messages.some(c=>c.type==='ticker-unsubscribe'&&c.id===oldId)).toBe(true);oldRelease();feed.updateTicker('one',tickerConfig({scope:[]}));expect(w.messages.at(-1).id).toBe(newId);feed.dispose();
});

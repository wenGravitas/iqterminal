import {it,expect,vi,afterEach} from 'vitest';
import {FeedClient} from '../src/feed/client';
class WorkerMock {static instance:WorkerMock;onmessage:((event:unknown)=>void)|null=null;messages:any[]=[];constructor(){WorkerMock.instance=this;}postMessage(c:unknown){this.messages.push(c);}terminate(){} }
afterEach(()=>vi.unstubAllGlobals());
it('subscription tokens reject queued old updates after switching away and back',()=>{
  vi.stubGlobal('Worker',WorkerMock);const client=new FeedClient();const callback=vi.fn();const s={venue:'binance',interval:'1m'} as const;
  client.subscribe('panel',s,callback);const first=WorkerMock.instance.messages.at(-1).id;
  client.subscribe('panel',{venue:'hyperliquid',interval:'1m'},callback);client.subscribe('panel',s,callback);const latest=WorkerMock.instance.messages.at(-1).id;
  WorkerMock.instance.onmessage?.({data:{type:'patch',key:'binance:perpetual:BTCUSDT:1m',ids:[first],candles:[]}});expect(callback).not.toHaveBeenCalled();
  WorkerMock.instance.onmessage?.({data:{type:'patch',key:'binance:perpetual:BTCUSDT:1m',ids:[latest],candles:[]}});expect(callback).toHaveBeenCalledOnce();client.dispose();
});

it('routes Order Walls history retry only to the active panel subscription',()=>{
  vi.stubGlobal('Worker',WorkerMock);const client=new FeedClient(),callback=vi.fn(),request={market:'binance-spot'} as any;
  const releaseOld=client.subscribeOrderWalls('panel',request,callback),worker=WorkerMock.instance,oldId=worker.messages.at(-1).id;
  client.retryOrderWallsHistory('panel');
  expect(worker.messages.at(-1)).toEqual({type:'order-wall-retry',id:oldId});
  client.subscribeOrderWalls('panel',request,callback);
  const newId=worker.messages.at(-1).id;
  releaseOld();
  client.retryOrderWallsHistory('panel');
  expect(worker.messages.at(-1)).toEqual({type:'order-wall-retry',id:newId});
  client.dispose();
  const count=worker.messages.length;
  client.retryOrderWallsHistory('panel');
  expect(worker.messages).toHaveLength(count);
});

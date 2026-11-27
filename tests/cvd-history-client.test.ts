import {it,expect,vi,afterEach} from 'vitest';
import {FeedClient} from '../src/feed/client';
import type {CvdHistoryRead} from '../src/feed/cvd-history-owner';
class WorkerMock {static instance:WorkerMock;onmessage:((event:any)=>void)|null=null;messages:any[]=[];constructor(){WorkerMock.instance=this;}postMessage(command:unknown){this.messages.push(command);}terminate(){} }
const request:CvdHistoryRead={source:'binance:perpetual',kind:'native',from:60000,to:120000};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('routes finite viewport and staged restore receipts through cancellable worker requests',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const client=new FeedClient(),worker=WorkerMock.instance,s=new AbortController().signal;
 const viewport=client.acquireCvdHistoryWindow({projection:{source:request.source,anchor:0,from:60000,to:120000,stepMs:60000}},s),command=worker.messages.at(-1);expect(command.type).toBe('cvd-history-window');worker.onmessage?.({data:{type:'cvd-history-result',ids:[command.id],window:{state:'loading',nextBefore:60000}}});expect(await viewport).toEqual({state:'loading',nextBefore:60000});
 const restore=client.restoreCvdHistoryPage({source:request.source,day:0,from:0,to:3600000},s),r=worker.messages.at(-1);expect(r.type).toBe('cvd-history-restore');worker.onmessage?.({data:{type:'cvd-history-result',ids:[r.id],restoration:{complete:false,missingRecords:2}}});expect(await restore).toEqual({complete:false,missingRecords:2});client.dispose();
});
it('routes cache-only projections through the same bounded request lifecycle',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const client=new FeedClient(),worker=WorkerMock.instance;
 const r={source:request.source,anchor:0,from:60000,to:120000,stepMs:60000};
 const projection=client.projectCvdHistory(r,new AbortController().signal);const command=worker.messages.at(-1);expect(command).toMatchObject({type:'cvd-history-project',request:r});
 worker.onmessage?.({data:{type:'cvd-history-result',ids:[command.id],projection:{version:1,points:[]}}});expect(await projection).toEqual({version:1,points:[]});
 const failed=client.projectCvdHistory(r,new AbortController().signal);worker.onmessage?.({data:{type:'cvd-history-result',ids:[worker.messages.at(-1).id],reason:'restore'}});await expect(failed).rejects.toMatchObject({reason:'restore'});client.dispose();
});
it('routes a receipt to its caller and ignores late replies after cancellation',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const client=new FeedClient(),worker=WorkerMock.instance,first=new AbortController();
 const a=client.readCvdHistory(request,first.signal).catch(error=>error),old=worker.messages.at(-1).id;
 first.abort();expect(await a).toBeInstanceOf(Error);expect(worker.messages.at(-1)).toEqual({type:'cvd-history-cancel',id:old});
 const b=client.readCvdHistory(request,new AbortController().signal),id=worker.messages.at(-1).id;
 worker.onmessage?.({data:{type:'cvd-history-result',ids:[old],receipt:{version:99}}});worker.onmessage?.({data:{type:'cvd-history-result',ids:[id],receipt:{version:2}}});expect(await b).toEqual({version:2});client.dispose();
});
it('bounds demand and cancels pending worker requests on timeout or disposal',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);const client=new FeedClient(),worker=WorkerMock.instance;
 const pending=Array.from({length:24},()=>client.readCvdHistory(request,new AbortController().signal).catch(error=>error));
 await expect(client.readCvdHistory(request,new AbortController().signal)).rejects.toThrow('capacity');expect(worker.messages).toHaveLength(24);
 await vi.advanceTimersByTimeAsync(20000);for(const p of pending)expect(await p).toBeInstanceOf(Error);expect(worker.messages.filter(m=>m.type==='cvd-history-cancel')).toHaveLength(24);
 const final=client.readCvdHistory(request,new AbortController().signal).catch(error=>error);client.dispose();expect(await final).toBeInstanceOf(Error);const count=worker.messages.length;await expect(client.readCvdHistory(request,new AbortController().signal)).rejects.toThrow('cancelled');expect(worker.messages).toHaveLength(count);expect(vi.getTimerCount()).toBe(0);
});

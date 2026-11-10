import {afterEach,expect,test,vi} from 'vitest';
import {historyHttpError} from '../src/feed/history-http-error';
afterEach(()=>vi.useRealTimers());
test('retains the specific source/query reason instead of discarding a failed history response',async()=>{
 const error=await historyHttpError(new Response(JSON.stringify({error:'ClickHouse 500: query\n execution time exceeded'}),{status:503}),new AbortController().signal,'Prepared wall discovery');
 expect(error.message).toBe('Prepared wall discovery HTTP 503: ClickHouse 500: query execution time exceeded');
});
test.each(['<html>bad gateway</html>','{"message":"not the error contract"}','{"error":{}}','{"error":"  "}'])('malformed or non-contract failure body falls back to status: %s',async body=>{
 expect((await historyHttpError(new Response(body,{status:502}),new AbortController().signal,'History')).message).toBe('History HTTP 502');
});
test('caps diagnostic bytes and cancels an oversized body without retaining or presenting it',async()=>{
 const cancel=vi.fn(),stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(4097));},cancel});
 expect((await historyHttpError(new Response(stream,{status:503}),new AbortController().signal,'History')).message).toBe('History HTTP 503');
 expect(cancel).toHaveBeenCalledOnce();expect(stream.locked).toBe(false);
});
test('caps the displayed reason separately from the bounded body',async()=>{
 expect((await historyHttpError(new Response(JSON.stringify({error:'x'.repeat(1000)}),{status:503}),new AbortController().signal,'History')).message).toBe('History HTTP 503: '+'x'.repeat(240));
});
test('stalled error delivery releases history admission after one second',async()=>{
 vi.useFakeTimers();const cancel=vi.fn(),stream=new ReadableStream<Uint8Array>({cancel});
 const result=historyHttpError(new Response(stream,{status:503}),new AbortController().signal,'History');
 await vi.advanceTimersByTimeAsync(1000);expect((await result).message).toBe('History HTTP 503');
 expect(cancel).toHaveBeenCalledOnce();expect(stream.locked).toBe(false);expect(vi.getTimerCount()).toBe(0);
});
test('consumer cancellation remains cancellation, not a new history failure',async()=>{
 const abort=new AbortController(),cancel=vi.fn(),stream=new ReadableStream<Uint8Array>({cancel});
 const result=historyHttpError(new Response(stream,{status:503}),abort.signal,'History');
 const rejection=expect(result).rejects.toMatchObject({name:'AbortError'});abort.abort();await rejection;
 expect(cancel).toHaveBeenCalledOnce();expect(stream.locked).toBe(false);
});

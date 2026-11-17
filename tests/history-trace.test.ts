import {expect,test} from 'vitest';
import {historyViewId,historyRequestTraces,tracedHistoryJson} from '../src/feed/history-trace';
test('proxy queue/header durations and gateway correlation remain distinct from worker header wait',async()=>{
 const id=historyViewId(),body={state:'ready',tiles:[]};let sent:RequestInit|undefined;
 const request=(async(_url,init)=>{sent=init;return new Response(JSON.stringify(body),{headers:{'x-iq-request-id':'gateway-fixture','x-iq-proxy-queue-ms':'82.15','x-iq-proxy-header-ms':'11.25','server-timing':'db;dur=2, proxyqueue;dur=82.15, proxyheader;dur=11.25'}});}) as typeof fetch;
 expect(await tracedHistoryJson(request,'/market-data/v2/history/footprints',new AbortController().signal,id,performance.now())).toEqual(body);
 expect(sent?.headers).toEqual({'X-IQ-View-Id':id});
 const trace=historyRequestTraces().find(t=>t.id===id)!;
 expect(trace).toMatchObject({requestId:'gateway-fixture',proxyQueueMs:82.15,proxyHeaderMs:11.25});
 expect(trace.headerMs).toBeGreaterThanOrEqual(0);expect(trace.serverTiming).toContain('db;dur=2');
 expect(trace.headerMs).toBe(trace.headersAt!-trace.wireAt); // Proxy phases are nested, never added to the local elapsed clock.
});

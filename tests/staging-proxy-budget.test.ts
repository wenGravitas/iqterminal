import {test,expect} from 'vitest';import {EventEmitter} from 'node:events';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {StagingHistoryBudget} from '../scripts/staging-proxy-budget';
class Response extends EventEmitter{destroyed=false;status=0;headers:Record<string,string>={};writeHead(status:number,headers:Record<string,string>){this.status=status;this.headers=headers;return this;}end(){this.emit('finish');}destroy(){this.destroyed=true;this.emit('close');}}
const admit=(budget:StagingHistoryBudget,lane:string,next:()=>void)=>{const response=new Response();budget.middleware({url:lane} as IncomingMessage,response as unknown as ServerResponse,next);return response;};
test('shared transport budget lends a slot to independent native reads and preserves bulk progress',()=>{
 const seen:string[]=[],budget=new StagingHistoryBudget(req=>req.url==='native'?'native':'bulk');
 const b1=admit(budget,'bulk',()=>seen.push('b1')),b2=admit(budget,'bulk',()=>seen.push('b2')),n1=admit(budget,'native',()=>seen.push('n1')),n2=admit(budget,'native',()=>seen.push('n2'));
 expect(seen).toEqual(['b1','b2','n1']);b1.end();expect(seen).toEqual(['b1','b2','n1','n2']);
 const b3=admit(budget,'bulk',()=>seen.push('b3'));n1.destroy();expect(seen.at(-1)).toBe('b3');budget.close();expect([b2,n2,b3].every(r=>r.destroyed)).toBe(true);
});
test('queued requests are bounded, canceled work never starts and close releases listeners',()=>{
 const seen:string[]=[],budget=new StagingHistoryBudget(req=>req.url==='native'?'native':'bulk');
 const active=[admit(budget,'bulk',()=>seen.push('b1')),admit(budget,'bulk',()=>seen.push('b2')),admit(budget,'native',()=>seen.push('n1'))];
 const pending=Array.from({length:128},(_,i)=>admit(budget,'bulk',()=>seen.push('q'+i))),overflow=admit(budget,'bulk',()=>seen.push('overflow'));
 expect(overflow.status).toBe(503);expect(overflow.headers['Retry-After']).toBe('1');pending[0]!.destroy();active[0]!.end();expect(seen.at(-1)).toBe('q1');expect(seen).not.toContain('q0');
 budget.close();expect([...active.slice(1),...pending].every(r=>r.destroyed)).toBe(true);for(const r of [...active,...pending]){expect(r.listenerCount('finish')).toBe(0);expect(r.listenerCount('close')).toBe(0);}
 const stopped=admit(budget,'native',()=>seen.push('stopped'));expect(stopped.status).toBe(503);expect(seen).not.toContain('stopped');
});

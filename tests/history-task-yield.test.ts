import {test,expect,vi,afterEach} from 'vitest';
import {yieldHistoryTask,historyTaskYieldMode} from '../src/feed/history-task-yield';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
test('native continuation is explicitly background priority with the consumer cancellation signal',async()=>{
 const signal=new AbortController().signal;let resume!:()=>void,done=false;
 const scheduler={postTask:vi.fn(function(this:unknown,callback:()=>void,options:unknown){expect(this).toBe(scheduler);expect(options).toEqual({priority:'background',signal});return new Promise<void>(resolve=>{resume=()=>{callback();resolve();};});})};
 vi.stubGlobal('scheduler',scheduler);expect(historyTaskYieldMode()).toBe('background-post-task');const work=yieldHistoryTask(signal).then(()=>done=true);await Promise.resolve();expect(done).toBe(false);resume();await work;expect(done).toBe(true);
});
test('unsupported platforms resume in a timer task and retain no cancellation listener after completion',async()=>{
 vi.stubGlobal('scheduler',undefined);expect(historyTaskYieldMode()).toBe('timer-fallback');vi.useFakeTimers();const control=new AbortController(),remove=vi.spyOn(control.signal,'removeEventListener');let done=false;
 const work=yieldHistoryTask(control.signal).then(()=>done=true);await Promise.resolve();expect(done).toBe(false);expect(vi.getTimerCount()).toBe(1);await vi.runAllTimersAsync();await work;expect(done).toBe(true);expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));expect(vi.getTimerCount()).toBe(0);
});
test('canceling fallback work clears its timer and preserves the cancellation reason',async()=>{
 vi.stubGlobal('scheduler',undefined);vi.useFakeTimers();const control=new AbortController(),reason=new DOMException('Obsolete view','AbortError'),work=yieldHistoryTask(control.signal);const rejected=expect(work).rejects.toBe(reason);control.abort(reason);await rejected;expect(vi.getTimerCount()).toBe(0);
});
test('already canceled work schedules no native task',async()=>{
 const postTask=vi.fn(),control=new AbortController();vi.stubGlobal('scheduler',{postTask});control.abort();await expect(yieldHistoryTask(control.signal)).rejects.toMatchObject({name:'AbortError'});expect(postTask).not.toHaveBeenCalled();
});
test('visible work uses ordinary visible priority, never user-blocking priority',async()=>{
 const signal=new AbortController().signal,postTask=vi.fn(async(callback:()=>void,options:unknown)=>{expect(options).toEqual({priority:'user-visible',signal});callback();});
 vi.stubGlobal('scheduler',{postTask});expect(historyTaskYieldMode('user-visible')).toBe('user-visible-post-task');await yieldHistoryTask(signal,'user-visible');expect(postTask).toHaveBeenCalledTimes(1);
});
test('bounded work executes in the scheduled task itself on native and timer paths',async()=>{
 for(const native of [true,false]){
  vi.useFakeTimers();let run!:()=>void;const callback=vi.fn(),control=new AbortController();
  vi.stubGlobal('scheduler',native?{postTask:vi.fn((work:()=>void)=>new Promise<void>(resolve=>{run=()=>{work();resolve();};}))}:undefined);
  const work=yieldHistoryTask(control.signal,'user-visible',callback);expect(callback).not.toHaveBeenCalled();
  if(native)run();else vi.runAllTimers();
  expect(callback).toHaveBeenCalledTimes(1);await work;expect(vi.getTimerCount()).toBe(0);
 }
});
test('timer work failures reject without leaking a cancellation listener or timer',async()=>{
 vi.useFakeTimers();vi.stubGlobal('scheduler',undefined);const control=new AbortController(),remove=vi.spyOn(control.signal,'removeEventListener'),error=Error('Work failed');
 const work=yieldHistoryTask(control.signal,'user-visible',()=>{throw error;}),failed=expect(work).rejects.toBe(error);vi.runAllTimers();await failed;
 expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));expect(vi.getTimerCount()).toBe(0);
});
test('a returned work promise has the same completion barrier on native and timer schedulers',async()=>{
 for(const native of [true,false]){
  vi.useFakeTimers();let release!:()=>void,done=false;const gate=new Promise<void>(resolve=>release=resolve);
  vi.stubGlobal('scheduler',native?{postTask:async(callback:()=>void)=>callback()}:undefined);
  const work=yieldHistoryTask(undefined,'user-visible',()=>gate).then(()=>done=true);if(!native)vi.runAllTimers();
  await Promise.resolve();expect(done).toBe(false);release();await work;expect(done).toBe(true);
 }
});

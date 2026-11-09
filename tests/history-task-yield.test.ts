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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scheduler, type Drawable } from '../src/chart/scheduler';

describe('visible chart scheduler', () => {
  const pending = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let visibilityListener: (() => void) | undefined;
  let documentHidden = false;

  const makeScheduler = () => {
    pending.clear();
    nextFrame = 0;
    visibilityListener = undefined;
    documentHidden = false;
    vi.stubGlobal('document', {
      get hidden() { return documentHidden; },
      addEventListener: (_type: string, listener: () => void) => { visibilityListener = listener; },
      removeEventListener: (_type: string, listener: () => void) => { if (visibilityListener === listener) visibilityListener = undefined; },
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      pending.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
    return new Scheduler();
  };

  const runFrame = (id = pending.keys().next().value as number | undefined, time = 16) => {
    if (id === undefined) throw new Error('No scheduled frame');
    const callback = pending.get(id);
    if (!callback) throw new Error(`Frame ${id} was cancelled`);
    pending.delete(id);
    callback(time);
  };

  afterEach(() => vi.unstubAllGlobals());

  it('flushes only dirty visible work and lets the queued frame process the rest', () => {
    const scheduler = makeScheduler();
    const calls: string[] = [];
    const chart = (id: string): Drawable => ({ visible: true, draw: () => calls.push(id) });
    const first = chart('first'), second = chart('second');

    scheduler.invalidate(first);
    scheduler.invalidate(second);
    expect(scheduler.flush(first)).toBe(true);
    expect(scheduler.flush(first)).toBe(false);
    expect(calls).toEqual(['first']);
    runFrame();
    expect(calls).toEqual(['first', 'second']);
    expect(scheduler.intervals).toEqual([]);
    scheduler.dispose();
  });

  it('does not draw a chart twice when another chart synchronously flushes it', () => {
    const scheduler = makeScheduler();
    const calls: string[] = [];
    const second: Drawable = { visible: true, draw: () => calls.push('second') };
    const first: Drawable = { visible: true, draw: () => { calls.push('first'); expect(scheduler.flush(second)).toBe(true); } };
    scheduler.invalidate(first);
    scheduler.invalidate(second);
    runFrame();
    expect(calls).toEqual(['first', 'second']);
    expect(pending.size).toBe(0);
    scheduler.dispose();
  });

  it('keeps invalidations raised inside a draw and retains hidden dirty work', () => {
    const scheduler = makeScheduler();
    const calls: string[] = [];
    let reinvalidated = false;
    const chart: Drawable = { visible: true, draw: () => {
      calls.push('chart');
      if (!reinvalidated) {
        reinvalidated = true;
        scheduler.invalidate(chart);
        expect(scheduler.flush(chart)).toBe(false);
      }
    } };
    scheduler.invalidate(chart);
    runFrame(undefined, 16);
    expect(calls).toEqual(['chart']);
    expect(pending.size).toBe(1);
    runFrame(undefined, 32);
    expect(calls).toEqual(['chart', 'chart']);

    const hiddenChart: Drawable = { visible: false, draw: () => calls.push('hidden') };
    scheduler.invalidate(hiddenChart);
    expect(scheduler.flush(hiddenChart)).toBe(false);
    hiddenChart.visible = true;
    documentHidden = true;
    visibilityListener?.();
    scheduler.invalidate(hiddenChart);
    expect(pending.size).toBe(0);
    expect(scheduler.flush(hiddenChart)).toBe(false);
    documentHidden = false;
    visibilityListener?.();
    runFrame(undefined, 48);
    expect(calls.at(-1)).toBe('hidden');
    scheduler.dispose();
    scheduler.invalidate(hiddenChart);
    expect(scheduler.flush(hiddenChart)).toBe(false);
    expect(pending.size).toBe(0);
  });
});

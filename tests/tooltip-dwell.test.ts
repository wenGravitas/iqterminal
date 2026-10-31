import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipDwell } from '../src/tooltip-dwell';

describe('TooltipDwell', () => {
  afterEach(() => vi.useRealTimers());

  it('activates after 500 ms and keeps repeated movement within the same owner active', () => {
    vi.useFakeTimers();
    const dwell = new TooltipDwell();
    const activate = vi.fn();

    expect(dwell.request('cvd', activate)).toBe(false);
    vi.advanceTimersByTime(499);
    expect(activate).not.toHaveBeenCalled();
    expect(dwell.request('cvd', activate)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalledOnce();
    expect(dwell.isActive('cvd')).toBe(true);
    expect(dwell.request('cvd', activate)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replaces a pending target and invokes only the latest callback after its own dwell', () => {
    vi.useFakeTimers();
    const dwell = new TooltipDwell();
    const first = vi.fn(), latest = vi.fn(), second = vi.fn();

    dwell.request('open-interest', first);
    vi.advanceTimersByTime(300);
    dwell.request('open-interest', latest);
    vi.advanceTimersByTime(200);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(dwell.isActive('open-interest')).toBe(true);
    expect(dwell.request('footprint-totals', second)).toBe(false);
    vi.advanceTimersByTime(499);
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(dwell.isActive('footprint-totals')).toBe(true);
  });

  it('cancels pending activation on clear and dispose', () => {
    vi.useFakeTimers();
    const dwell = new TooltipDwell();
    const cleared = vi.fn(), disposed = vi.fn();

    dwell.request('trade-bubbles', cleared);
    vi.advanceTimersByTime(300);
    dwell.clear();
    vi.advanceTimersByTime(500);
    expect(cleared).not.toHaveBeenCalled();
    expect(dwell.isActive('trade-bubbles')).toBe(false);

    dwell.request('liquidations', disposed);
    dwell.dispose();
    vi.advanceTimersByTime(500);
    expect(disposed).not.toHaveBeenCalled();
    expect(dwell.request('liquidations', disposed)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

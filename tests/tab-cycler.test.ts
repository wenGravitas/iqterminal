import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupTabCycler, type CyclePanel } from '../src/tab-cycler';

function setup(ids = ['a', 'b', 'c']) {
  let panels: CyclePanel[];
  let activePanel: CyclePanel | undefined;
  const activations: string[] = [];
  panels = ids.map(id => {
    const panel: CyclePanel = { id, api: { setActive() { activePanel = panel; activations.push(id); } } };
    return panel;
  });
  activePanel = panels[0];
  const group = {
    get panels() { return panels; },
    get activePanel() { return activePanel; },
  };
  return { group, activations, current: () => activePanel, replacePanels: (next: CyclePanel[]) => { panels = next; } };
}

describe('GroupTabCycler', () => {
  afterEach(() => vi.useRealTimers());

  it('waits the full dwell, follows the latest left-to-right order, and wraps', () => {
    vi.useFakeTimers();
    const state = setup();
    const cycler = new GroupTabCycler(state.group);
    expect(cycler.start(5)).toBe(true);
    vi.advanceTimersByTime(4999);
    expect(state.current()?.id).toBe('a');
    state.replacePanels([state.group.panels[0]!, state.group.panels[2]!, state.group.panels[1]!]);
    vi.advanceTimersByTime(1);
    expect(state.current()?.id).toBe('c');
    state.replacePanels([state.group.panels[0]!, state.group.panels[2]!, state.group.panels[1]!]);
    vi.advanceTimersByTime(5000);
    expect(state.current()?.id).toBe('a');
    expect(state.activations).toEqual(['c', 'a']);
    cycler.dispose();
  });

  it('resets dwell on a manual activation and pauses for a full interval while hidden', () => {
    vi.useFakeTimers();
    const state = setup();
    const cycler = new GroupTabCycler(state.group);
    expect(cycler.start(2)).toBe(true);
    vi.advanceTimersByTime(1000);
    state.replacePanels([...state.group.panels]);
    // A manual tab switch does not invoke DOM focus; the adapter only observes this activation.
    state.group.panels[1]!.api.setActive();
    cycler.activePanelChanged();
    vi.advanceTimersByTime(1999);
    expect(state.current()?.id).toBe('b');
    cycler.pause('hidden');
    vi.advanceTimersByTime(60_000);
    expect(state.current()?.id).toBe('b');
    cycler.resume('hidden');
    vi.advanceTimersByTime(1999);
    expect(state.current()?.id).toBe('b');
    vi.advanceTimersByTime(1);
    expect(state.current()?.id).toBe('c');
    cycler.dispose();
  });

  it('stops when a group reaches one tab and clears timers on disposal', () => {
    vi.useFakeTimers();
    const state = setup(['a', 'b']);
    const cycler = new GroupTabCycler(state.group);
    expect(cycler.start(1)).toBe(true);
    state.replacePanels([state.group.panels[0]!]);
    cycler.groupChanged();
    expect(cycler.running).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(state.current()?.id).toBe('a');
    expect(state.activations).toEqual([]);

    cycler.dispose();
    vi.advanceTimersByTime(1000);
    expect(state.activations).toEqual([]);
    expect(cycler.start(1)).toBe(false);

    const pending = setup(['x', 'y']);
    const pendingCycler = new GroupTabCycler(pending.group);
    expect(pendingCycler.start(1)).toBe(true);
    pendingCycler.dispose();
    vi.advanceTimersByTime(1000);
    expect(pending.activations).toEqual([]);
  });

  it('rejects invalid dwell times and does not run a single-tab group', () => {
    vi.useFakeTimers();
    const state = setup(['a']);
    const cycler = new GroupTabCycler(state.group);
    for (const seconds of [0, -1, 1.5, 3601, Number.NaN]) expect(cycler.start(seconds)).toBe(false);
    expect(cycler.running).toBe(false);
    cycler.dispose();
  });
});

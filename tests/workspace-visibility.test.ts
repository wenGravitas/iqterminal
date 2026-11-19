import { describe, expect, it } from 'vitest';
import { workspacePanelVisible, onWorkspaceVisibilityChange } from '../src/workspaces/visibility';
function signal() { const listeners = new Set<() => void>(); return { event: (fn: () => void) => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; }, fire: () => listeners.forEach(fn => fn()), listeners }; }
describe('workspace effective visibility', () => {
  it('tracks collapsed borders, rebinds after moves and disposes subscriptions', async () => {
    const visibility = signal(), move = signal(), location = signal(), collapse = signal(), nextCollapse = signal();
    let collapsed = false;
    const api: any = { isVisible: true, location: { type: 'edge' }, group: { api: { isCollapsed: () => collapsed, onDidCollapsedChange: collapse.event } }, onDidVisibilityChange: visibility.event, onDidGroupChange: move.event, onDidLocationChange: location.event };
    const states: boolean[] = [];
    const release = onWorkspaceVisibilityChange(api, () => states.push(workspacePanelVisible(api)));
    await Promise.resolve(); expect(states).toEqual([true]);
    collapsed = true; collapse.fire(); expect(states.at(-1)).toBe(false);
    api.location = { type: 'grid' }; api.group.api = { isCollapsed: () => false, onDidCollapsedChange: nextCollapse.event }; move.fire();
    expect(states.at(-1)).toBe(true); expect(collapse.listeners.size).toBe(0);
    api.isVisible = false; visibility.fire(); expect(states.at(-1)).toBe(false);
    release.dispose(); expect(nextCollapse.listeners.size).toBe(0); expect(visibility.listeners.size).toBe(0);
  });
});

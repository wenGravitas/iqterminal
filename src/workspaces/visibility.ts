import type { DockviewPanelApi } from 'dockview-core';

/** Core's edge collapse hides content without changing panel.api.isVisible. */
export function workspacePanelVisible(api: DockviewPanelApi): boolean {
  return api.isVisible && !(api.location.type === 'edge' && api.group.api.isCollapsed());
}

export function onWorkspaceVisibilityChange(api: DockviewPanelApi, listener: () => void) {
  let disposed = false;
  queueMicrotask(() => { if (!disposed) listener(); });
  let collapse = api.group.api.onDidCollapsedChange(listener);
  const subscriptions = [api.onDidVisibilityChange(listener), api.onDidGroupChange(() => {
    collapse.dispose();
    collapse = api.group.api.onDidCollapsedChange(listener);
    listener();
  }), api.onDidLocationChange(listener)];
  return { dispose() { disposed = true; collapse.dispose(); subscriptions.forEach(subscription => subscription.dispose()); } };
}

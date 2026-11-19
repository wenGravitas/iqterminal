import type { DockviewApi, ContextMenuItem, IDockviewPanel, DockviewGroupPanel } from 'dockview-core';
export const BORDER_SIDES = ['left', 'right', 'top', 'bottom'] as const;
export type BorderSide = typeof BORDER_SIDES[number];

/** One Dockview owns every panel, including panels in its optional edge shell. */
export function moveToBorder(dock: DockviewApi, panel: IDockviewPanel, side: BorderSide) {
  if (dock.getPanel(panel.id) !== panel) return;
  let edge = dock.getEdgeGroup(side);
  if (!edge) edge = dock.addEdgeGroup(side, {
    id: `workspace-border-${side}`, initialSize: side === 'left' || side === 'right' ? 300 : 240,
    minimumSize: 120, maximumSize: 800, collapsedSize: 26,
  });
  const group = dock.groups.find(group => group.id === edge.id);
  if (!group) return;
  edge.expand();
  panel.api.moveTo({ group });
  panel.api.setActive();
}

export function borderMenu(dock: DockviewApi, panel: IDockviewPanel): ContextMenuItem[] {
  const location = panel.api.location;
  return [
    ...BORDER_SIDES.map(side => ({ label: `Move to ${side} border`, action: () => moveToBorder(dock, panel, side) })),
    { label: 'Move to central workspace', disabled: location.type === 'grid', action: () => {
      const group = dock.groups.find(group => group.api.location.type === 'grid') ?? dock.addGroup();
      panel.api.moveTo({ group });
    } },
    ...(location.type === 'edge' ? [{ label: dock.getEdgeGroup(location.position)?.isCollapsed() ? 'Expand border' : 'Collapse border', action: () => {
      const edge = dock.getEdgeGroup(location.position);
      if (edge?.isCollapsed()) edge.expand(); else edge?.collapse();
    } }] : []),
  ];
}

export function borderAtPoint(rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, x: number, y: number): BorderSide | undefined {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
  const distances: [BorderSide, number][] = [['left', x - rect.left], ['right', rect.right - x], ['top', y - rect.top], ['bottom', rect.bottom - y]];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0]![1] <= 24 ? distances[0]![0] : undefined;
}

export function installBorders(dock: DockviewApi, root: HTMLElement) {
  let disposed = false;
  let canceled = false;
  const abort = new AbortController();
  const targets = document.createElement('div');
  targets.className = 'workspace-border-targets';
  targets.hidden = true;
  targets.setAttribute('aria-hidden', 'true');
  for (const side of BORDER_SIDES) {
    const target = document.createElement('div'); target.dataset.side = side; target.textContent = `${side} border`; targets.append(target);
  }
  document.body.append(targets);
  const start = () => {
    canceled = false;
    const rect = root.getBoundingClientRect();
    Object.assign(targets.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    targets.hidden = false;
  };
  const stop = () => { targets.hidden = true; delete targets.dataset.active; };
  document.addEventListener('pointermove', event => {
    if (!targets.hidden) targets.dataset.active = borderAtPoint(root.getBoundingClientRect(), event.clientX, event.clientY) ?? '';
  }, { signal: abort.signal });
  document.addEventListener('pointerup', () => queueMicrotask(stop), { signal: abort.signal });
  document.addEventListener('pointercancel', stop, { signal: abort.signal });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !targets.hidden) { canceled = true; stop(); } }, { signal: abort.signal });
  const subscriptions = [dock.onWillDragPanel(start), dock.onWillDragGroup(start), dock.onWillDrop(event => {
    if (canceled) { event.preventDefault(); return; }
    const side = borderAtPoint(root.getBoundingClientRect(), event.nativeEvent.clientX, event.nativeEvent.clientY);
    if (!side) return;
    // Edge tab strips also sit inside the outer target band. Their own tab
    // insertion index must win, otherwise a reorder becomes an append.
    if ((event.kind === 'tab' || event.kind === 'header_space') && event.group?.api.location.type === 'edge' && event.group.api.location.position === side) return;
    const data = event.getData();
    if (!data || data.viewId !== dock.id) return;
    const panels = data.panelId ? [dock.getPanel(data.panelId)].filter((panel): panel is IDockviewPanel => Boolean(panel)) : [...(dock.groups.find(group => group.id === data.groupId)?.panels ?? [])];
    if (!panels.length) return;
    event.preventDefault();
    for (const panel of panels) moveToBorder(dock, panel, side);
  }), dock.onDidLayoutChange(() => {
    queueMicrotask(() => {
      if (disposed) return;
      for (const side of BORDER_SIDES) {
        const edge = dock.getEdgeGroup(side);
        const group = edge && dock.groups.find(group => group.id === edge.id);
        if (group && !group.panels.length) dock.removeEdgeGroup(side);
      }
    });
  })];
  return { dispose() { disposed = true; abort.abort(); targets.remove(); subscriptions.forEach(subscription => subscription.dispose()); } };
}

/** Native header action stays available when the edge is collapsed. */
export class BorderHeaderAction {
  readonly element = document.createElement('button');
  private readonly subscriptions: { dispose(): void }[];
  constructor(private readonly group: DockviewGroupPanel) {
    this.element.type = 'button';
    this.element.className = 'tab-cycle-toggle workspace-border-toggle';
    const render = () => {
      const location = group.api.location;
      this.element.hidden = location.type !== 'edge';
      const label = `${group.api.isCollapsed() ? 'Expand' : 'Collapse'} ${location.type === 'edge' ? location.position : ''} border`;
      this.element.title = label;
      this.element.setAttribute('aria-label', label);
      this.element.setAttribute('aria-expanded', String(!group.api.isCollapsed()));
      this.element.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8h10M8 3v10" fill="none" stroke="currentColor"/></svg>';
      if (!group.api.isCollapsed()) this.element.querySelector('path')!.setAttribute('d', 'M3 8h10');
    };
    this.element.onpointerdown = event => event.stopPropagation();
    this.element.onclick = event => { event.stopPropagation(); if (group.api.isCollapsed()) group.api.expand(); else group.api.collapse(); };
    this.subscriptions = [group.api.onDidCollapsedChange(render), group.api.onDidLocationChange(render)];
    render();
    queueMicrotask(() => { if (this.element.isConnected) render(); });
  }
  init() {}
  dispose() { this.subscriptions.forEach(subscription => subscription.dispose()); this.element.onpointerdown = null; this.element.onclick = null; }
}

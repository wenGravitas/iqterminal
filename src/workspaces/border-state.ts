import type { SerializedDockview } from 'dockview-core';

/** Validate only the optional extension; legacy Dockview layouts stay untouched. */
export function validBorderState(layout: SerializedDockview): boolean {
  const edges = layout.edgeGroups;
  if (edges === undefined) return true;
  if (!edges || typeof edges !== 'object' || Array.isArray(edges)) return false;
  const ids = new Set<string>();
  for (const [side, edge] of Object.entries(edges)) {
    if (!['left', 'right', 'top', 'bottom'].includes(side) || !edge || typeof edge !== 'object') return false;
    if (!Number.isFinite(edge.size) || edge.size < 0 || typeof edge.visible !== 'boolean') return false;
    for (const key of ['collapsed', 'autoHide', 'autoReveal'] as const) if (edge[key] !== undefined && typeof edge[key] !== 'boolean') return false;
    for (const key of ['minimumSize', 'maximumSize', 'collapsedSize'] as const) if (edge[key] !== undefined && (!Number.isFinite(edge[key]) || edge[key]! < 0)) return false;
    const group = edge.group as { id?: unknown; views?: unknown; activeView?: unknown } | undefined;
    if (!group || typeof group.id !== 'string' || !Array.isArray(group.views) || group.views.some(id => typeof id !== 'string' || !layout.panels[id] || ids.has(id))) return false;
    if (group.activeView !== undefined && !group.views.includes(group.activeView)) return false;
    for (const id of group.views) { if (ids.has(id)) return false; ids.add(id); }
  }
  // A panel must not simultaneously belong to the central grid and a border.
  const overlaps = (node: any): boolean => node?.type === 'leaf' ? (node.data?.views ?? []).some((id: string) => ids.has(id)) : Array.isArray(node?.data) && node.data.some(overlaps);
  return !overlaps(layout.grid.root);
}

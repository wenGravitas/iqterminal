export const IQ_OBJECT_TREE_VERSION = 1 as const;
export const IQ_OBJECT_TREE_STORAGE_PREFIX = 'iqterminal:object-tree:v1';
export const IQ_OBJECT_TREE_SIDEBAR_PREFIX = 'iqterminal:object-tree-sidebar:v1';
export const OBJECT_TREE_MAX_DEPTH = 8;
export const OBJECT_TREE_MAX_ENTRIES = 2000;
export const OBJECT_TREE_DEFAULT_WIDTH = 280;
export const OBJECT_TREE_MIN_WIDTH = 200;
export const OBJECT_TREE_MAX_WIDTH = 520;

export interface ObjectTreeDrawingEntry {
  type: 'drawing';
  drawingId: string;
  name?: string;
}

export interface ObjectTreeFolderEntry {
  type: 'folder';
  id: string;
  name: string;
  children: ObjectTreeEntry[];
}

export type ObjectTreeEntry = ObjectTreeDrawingEntry | ObjectTreeFolderEntry;

export interface IQObjectTreeCatalog {
  version: typeof IQ_OBJECT_TREE_VERSION;
  revision: number;
  entries: ObjectTreeEntry[];
}

export interface IQObjectTreeSidebarPreferences {
  version: typeof IQ_OBJECT_TREE_VERSION;
  width: number;
  collapsed: boolean;
}

export class IQObjectTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IQObjectTreeError';
  }
}

export interface IQObjectTreeStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IQObjectTreeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function safeId(value: unknown, name: string, maximum = 160): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new IQObjectTreeError(`${name} is invalid`);
  }
  return value;
}

function folderName(value: unknown): string {
  if (typeof value !== 'string') throw new IQObjectTreeError('Folder name is invalid');
  const name = value.trim();
  if (!name || name.length > 48 || /[\u0000-\u001f\u007f]/.test(name)) throw new IQObjectTreeError('Folder names must be 1–48 characters');
  return name;
}

export function createEmptyObjectTree(): IQObjectTreeCatalog {
  return { version: IQ_OBJECT_TREE_VERSION, revision: 0, entries: [] };
}

export function parseIQObjectTreeCatalog(input: unknown): IQObjectTreeCatalog {
  let parsed = input;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); }
    catch { throw new IQObjectTreeError('Saved object tree contains invalid JSON; the stored record was left untouched.'); }
  }
  const source = record(parsed, 'Object tree catalog');
  if (source.version !== IQ_OBJECT_TREE_VERSION) throw new IQObjectTreeError('Saved object tree version is unsupported; the stored record was left untouched.');
  if (!Number.isSafeInteger(source.revision) || (source.revision as number) < 0) throw new IQObjectTreeError('Object tree revision is invalid');
  if (!Array.isArray(source.entries)) throw new IQObjectTreeError('Object tree entries are invalid');

  const folderIds = new Set<string>();
  const drawingIds = new Set<string>();
  let count = 0;
  const parseEntries = (entries: unknown[], depth: number): ObjectTreeEntry[] => entries.map(value => {
    count++;
    if (count > OBJECT_TREE_MAX_ENTRIES) throw new IQObjectTreeError('Object tree contains too many entries');
    const entry = record(value, 'Object tree entry');
    if (entry.type === 'drawing') {
      const drawingId = safeId(entry.drawingId, 'Drawing id');
      if (drawingIds.has(drawingId)) throw new IQObjectTreeError('A drawing appears more than once in the object tree');
      drawingIds.add(drawingId);
      return { type: 'drawing', drawingId, ...(entry.name === undefined ? {} : { name: folderName(entry.name) }) };
    }
    if (entry.type !== 'folder') throw new IQObjectTreeError('Object tree entry type is unsupported');
    if (depth >= OBJECT_TREE_MAX_DEPTH) throw new IQObjectTreeError(`Object tree folders cannot be nested deeper than ${OBJECT_TREE_MAX_DEPTH} levels`);
    const id = safeId(entry.id, 'Folder id', 96);
    if (folderIds.has(id)) throw new IQObjectTreeError('Folder ids must be unique');
    folderIds.add(id);
    if (!Array.isArray(entry.children)) throw new IQObjectTreeError('Folder contents are invalid');
    return { type: 'folder', id, name: folderName(entry.name), children: parseEntries(entry.children, depth + 1) };
  });

  return {
    version: IQ_OBJECT_TREE_VERSION,
    revision: source.revision as number,
    entries: parseEntries(source.entries, 0),
  };
}

export function parseIQObjectTreeSidebarPreferences(input: unknown): IQObjectTreeSidebarPreferences {
  let parsed = input;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); }
    catch { throw new IQObjectTreeError('Saved object tree sidebar settings contain invalid JSON; the stored record was left untouched.'); }
  }
  const source = record(parsed, 'Object tree sidebar settings');
  if (source.version !== IQ_OBJECT_TREE_VERSION) throw new IQObjectTreeError('Saved object tree sidebar version is unsupported; the stored record was left untouched.');
  if (typeof source.width !== 'number' || !Number.isFinite(source.width) || typeof source.collapsed !== 'boolean') {
    throw new IQObjectTreeError('Saved object tree sidebar settings are invalid');
  }
  return {
    version: IQ_OBJECT_TREE_VERSION,
    width: Math.max(OBJECT_TREE_MIN_WIDTH, Math.min(OBJECT_TREE_MAX_WIDTH, Math.round(source.width))),
    collapsed: source.collapsed,
  };
}

export function objectTreeStorageKey(panelId: string, venueMarket: string, symbol: string): string {
  return `${IQ_OBJECT_TREE_STORAGE_PREFIX}:${encodeURIComponent(panelId)}:${encodeURIComponent(venueMarket)}:${encodeURIComponent(symbol)}`;
}

export function objectTreeSidebarStorageKey(panelId: string): string {
  return `${IQ_OBJECT_TREE_SIDEBAR_PREFIX}:${encodeURIComponent(panelId)}`;
}

export function createLocalStorageObjectTreeStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): IQObjectTreeStorage {
  return {
    read: key => storage.getItem(key),
    write: (key, value) => storage.setItem(key, value),
  };
}

export function createMemoryObjectTreeStorage(): IQObjectTreeStorage {
  const values = new Map<string, string>();
  return {
    read: key => values.get(key) ?? null,
    write: (key, value) => { values.set(key, value); },
  };
}

export class IQObjectTreeRepository {
  private current = createEmptyObjectTree();
  private loaded = false;
  private writeError?: Error;

  constructor(private readonly storage: IQObjectTreeStorage, private readonly key: string) {}

  load(): IQObjectTreeCatalog {
    if (this.loaded) return this.current;
    const saved = this.storage.read(this.key);
    this.current = saved === null ? createEmptyObjectTree() : parseIQObjectTreeCatalog(saved);
    this.loaded = true;
    return this.current;
  }

  save(catalog: IQObjectTreeCatalog): IQObjectTreeCatalog {
    const next = parseIQObjectTreeCatalog({
      version: IQ_OBJECT_TREE_VERSION,
      revision: this.current.revision + 1,
      entries: catalog.entries,
    });
    this.current = next;
    this.loaded = true;
    try {
      this.storage.write(this.key, JSON.stringify(next));
      this.writeError = undefined;
    } catch (error) {
      this.writeError = error instanceof Error ? error : new Error(String(error));
    }
    return next;
  }

  error(): Error | undefined { return this.writeError; }
}

export function reconcileObjectTree(catalog: IQObjectTreeCatalog, liveDrawingIds: readonly string[]): { catalog: IQObjectTreeCatalog; changed: boolean } {
  const live = new Set(liveDrawingIds);
  const found = new Set<string>();
  let changed = false;
  const prune = (entries: readonly ObjectTreeEntry[]): ObjectTreeEntry[] => {
    const result: ObjectTreeEntry[] = [];
    for (const entry of entries) {
      if (entry.type === 'drawing') {
        if (!live.has(entry.drawingId)) { changed = true; continue; }
        found.add(entry.drawingId);
        result.push(entry);
      } else {
        const children = prune(entry.children);
        if (children.length !== entry.children.length) changed = true;
        result.push({ ...entry, children });
      }
    }
    return result;
  };
  const entries = prune(catalog.entries);
  for (const drawingId of liveDrawingIds) {
    if (found.has(drawingId)) continue;
    entries.push({ type: 'drawing', drawingId });
    changed = true;
  }
  return { catalog: changed ? { ...catalog, entries } : catalog, changed };
}

export function findObjectTreeEntry(entries: readonly ObjectTreeEntry[], kind: 'folder' | 'drawing', id: string): ObjectTreeEntry | undefined {
  for (const entry of entries) {
    if (kind === 'folder' && entry.type === 'folder' && entry.id === id) return entry;
    if (kind === 'drawing' && entry.type === 'drawing' && entry.drawingId === id) return entry;
    if (entry.type === 'folder') {
      const found = findObjectTreeEntry(entry.children, kind, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function objectTreeFolderPaths(entries: readonly ObjectTreeEntry[], parentPath: readonly string[] = []): Array<{ id: string; path: string }> {
  const paths: Array<{ id: string; path: string }> = [];
  for (const entry of entries) {
    if (entry.type !== 'folder') continue;
    const path = [...parentPath, entry.name];
    paths.push({ id: entry.id, path: path.join(' / ') });
    paths.push(...objectTreeFolderPaths(entry.children, path));
  }
  return paths;
}

export function objectTreeDrawingIds(entries: readonly ObjectTreeEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'drawing') ids.push(entry.drawingId);
    else ids.push(...objectTreeDrawingIds(entry.children));
  }
  return ids;
}

export function objectTreeFolderDrawingIds(entries: readonly ObjectTreeEntry[], folderId: string): string[] {
  const folder = findObjectTreeEntry(entries, 'folder', folderId);
  return folder?.type === 'folder' ? objectTreeDrawingIds(folder.children) : [];
}

export function objectTreeFolderVisibilityState(
  entries: readonly ObjectTreeEntry[],
  folderId: string,
  visibleForDrawing: (drawingId: string) => boolean | undefined,
): 'all' | 'none' | 'mixed' {
  const visibility = objectTreeFolderDrawingIds(entries, folderId)
    .map(visibleForDrawing)
    .filter((visible): visible is boolean => visible !== undefined)
    .map(visible => visible !== false);
  if (visibility.length === 0 || visibility.every(visible => !visible)) return 'none';
  return visibility.every(Boolean) ? 'all' : 'mixed';
}

export interface ObjectTreeVisibilityPatch {
  id: string;
  patch: { visible: boolean };
}

/** Apply an explicit recursive visibility command as one native controller batch. */
export function applyObjectTreeFolderVisibility(
  entries: readonly ObjectTreeEntry[],
  folderId: string,
  visible: boolean,
  getDrawing: (drawingId: string) => { visible?: boolean } | undefined,
  updateMany: (patches: readonly ObjectTreeVisibilityPatch[]) => void,
): number {
  const patches = objectTreeFolderDrawingIds(entries, folderId).flatMap(id =>
    getDrawing(id) ? [{ id, patch: { visible } }] : [],
  );
  if (patches.length) updateMany(patches);
  return patches.length;
}

function containerAt(entries: ObjectTreeEntry[], parentId: string | null): ObjectTreeEntry[] | undefined {
  if (parentId === null) return entries;
  const parent = findObjectTreeEntry(entries, 'folder', parentId);
  return parent?.type === 'folder' ? parent.children : undefined;
}

function locate(entries: ObjectTreeEntry[], kind: 'folder' | 'drawing', id: string): { parentId: string | null; index: number; entry: ObjectTreeEntry } | undefined {
  const walk = (siblings: ObjectTreeEntry[], parentId: string | null): ReturnType<typeof locate> => {
    for (let index = 0; index < siblings.length; index++) {
      const entry = siblings[index]!;
      if ((kind === 'folder' && entry.type === 'folder' && entry.id === id) || (kind === 'drawing' && entry.type === 'drawing' && entry.drawingId === id)) {
        return { parentId, index, entry };
      }
      if (entry.type === 'folder') {
        const found = walk(entry.children, entry.id);
        if (found) return found;
      }
    }
  };
  return walk(entries, null);
}

export function locateObjectTreeEntry(entries: ObjectTreeEntry[], kind: 'folder' | 'drawing', id: string): { parentId: string | null; index: number; entry: ObjectTreeEntry } | undefined {
  return locate(entries, kind, id);
}

function folderDepth(entries: readonly ObjectTreeEntry[], id: string | null, depth = 0): number | undefined {
  if (id === null) return 0;
  for (const entry of entries) {
    if (entry.type !== 'folder') continue;
    if (entry.id === id) return depth + 1;
    const nested = folderDepth(entry.children, id, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function objectTreeFolderDepth(entries: readonly ObjectTreeEntry[], id: string): number | undefined {
  return folderDepth(entries, id);
}

function subtreeFolderHeight(entry: ObjectTreeEntry): number {
  if (entry.type !== 'folder') return 0;
  return 1 + Math.max(0, ...entry.children.map(subtreeFolderHeight));
}

export function createObjectTreeFolder(catalog: IQObjectTreeCatalog, parentId: string | null, id: string, name: string): IQObjectTreeCatalog | null {
  const parentDepth = folderDepth(catalog.entries, parentId);
  if (parentDepth === undefined || parentDepth + 1 > OBJECT_TREE_MAX_DEPTH || findObjectTreeEntry(catalog.entries, 'folder', id)) return null;
  const children = containerAt(catalog.entries, parentId);
  if (!children) return null;
  const validatedName = folderName(name);
  return { ...catalog, entries: insertInto(catalog.entries, parentId, children.length, { type: 'folder', id, name: validatedName, children: [] }) };
}

export function renameObjectTreeFolder(catalog: IQObjectTreeCatalog, id: string, name: string): IQObjectTreeCatalog | null {
  const validatedName = folderName(name);
  let changed = false;
  const rename = (entries: readonly ObjectTreeEntry[]): ObjectTreeEntry[] => entries.map(entry => {
    if (entry.type !== 'folder') return entry;
    if (entry.id === id) { changed = true; return { ...entry, name: validatedName }; }
    return { ...entry, children: rename(entry.children) };
  });
  const entries = rename(catalog.entries);
  return changed ? { ...catalog, entries } : null;
}

export function renameObjectTreeDrawing(catalog: IQObjectTreeCatalog, id: string, name: string): IQObjectTreeCatalog | null {
  const validatedName = folderName(name);
  let changed = false;
  const rename = (entries: readonly ObjectTreeEntry[]): ObjectTreeEntry[] => entries.map(entry => {
    if (entry.type === 'drawing') {
      if (entry.drawingId !== id || entry.name === validatedName) return entry;
      changed = true;
      return { ...entry, name: validatedName };
    }
    return { ...entry, children: rename(entry.children) };
  });
  const entries = rename(catalog.entries);
  return changed ? { ...catalog, entries } : null;
}

export function clearObjectTreeDrawingName(catalog: IQObjectTreeCatalog, id: string): IQObjectTreeCatalog | null {
  let changed = false;
  const clear = (entries: readonly ObjectTreeEntry[]): ObjectTreeEntry[] => entries.map(entry => {
    if (entry.type === 'drawing') {
      if (entry.drawingId !== id || entry.name === undefined) return entry;
      const { name: _name, ...rest } = entry;
      changed = true;
      return rest;
    }
    return { ...entry, children: clear(entry.children) };
  });
  const entries = clear(catalog.entries);
  return changed ? { ...catalog, entries } : null;
}

export function deleteObjectTreeFolder(catalog: IQObjectTreeCatalog, id: string): IQObjectTreeCatalog | null {
  let changed = false;
  const remove = (entries: readonly ObjectTreeEntry[]): ObjectTreeEntry[] => entries.flatMap(entry => {
    if (entry.type !== 'folder') return [entry];
    if (entry.id === id) { changed = true; return entry.children; }
    return [{ ...entry, children: remove(entry.children) }];
  });
  const entries = remove(catalog.entries);
  return changed ? { ...catalog, entries } : null;
}

function insertInto(entries: ObjectTreeEntry[], parentId: string | null, index: number, entry: ObjectTreeEntry): ObjectTreeEntry[] {
  if (parentId === null) {
    const copy = [...entries];
    copy.splice(Math.max(0, Math.min(copy.length, index)), 0, entry);
    return copy;
  }
  return entries.map(candidate => candidate.type === 'folder'
    ? candidate.id === parentId
      ? { ...candidate, children: insertInto(candidate.children, null, index, entry) }
      : { ...candidate, children: insertInto(candidate.children, parentId, index, entry) }
    : candidate);
}

export function moveObjectTreeEntry(
  catalog: IQObjectTreeCatalog,
  kind: 'folder' | 'drawing',
  id: string,
  parentId: string | null,
  index: number,
): IQObjectTreeCatalog | null {
  const source = locate(catalog.entries, kind, id);
  if (!source) return null;
  if (kind === 'folder') {
    if (parentId === id) return null;
    const descendantIds = new Set(objectTreeFolderPaths([source.entry]).map(folder => folder.id));
    if (parentId !== null && descendantIds.has(parentId)) return null;
    const targetDepth = folderDepth(catalog.entries, parentId);
    if (targetDepth === undefined || targetDepth + subtreeFolderHeight(source.entry) > OBJECT_TREE_MAX_DEPTH) return null;
  } else if (parentId !== null && folderDepth(catalog.entries, parentId) === undefined) return null;

  const without: ObjectTreeEntry[] = [];
  const remove = (entries: readonly ObjectTreeEntry[]): ObjectTreeEntry[] => {
    const result: ObjectTreeEntry[] = [];
    for (const entry of entries) {
      if ((kind === 'folder' && entry.type === 'folder' && entry.id === id) || (kind === 'drawing' && entry.type === 'drawing' && entry.drawingId === id)) continue;
      result.push(entry.type === 'folder' ? { ...entry, children: remove(entry.children) } : entry);
    }
    return result;
  };
  without.push(...remove(catalog.entries));
  const target = containerAt(without, parentId);
  if (!target) return null;
  const currentIndex = source.parentId === parentId && source.index < index ? index - 1 : index;
  const boundedIndex = Math.max(0, Math.min(target.length, currentIndex));
  if (source.parentId === parentId && source.index === boundedIndex) return null;
  return { ...catalog, entries: insertInto(without, parentId, boundedIndex, source.entry) };
}

export function reorderObjectTreeEntry(catalog: IQObjectTreeCatalog, kind: 'folder' | 'drawing', id: string, direction: -1 | 1): IQObjectTreeCatalog | null {
  const source = locate(catalog.entries, kind, id);
  if (!source) return null;
  return moveObjectTreeEntry(catalog, kind, id, source.parentId, source.index + direction + (direction > 0 ? 1 : 0));
}

export function createObjectTreeSidebarPreferences(width = OBJECT_TREE_DEFAULT_WIDTH, collapsed = false): IQObjectTreeSidebarPreferences {
  return {
    version: IQ_OBJECT_TREE_VERSION,
    width: Math.max(OBJECT_TREE_MIN_WIDTH, Math.min(OBJECT_TREE_MAX_WIDTH, Math.round(width))),
    collapsed,
  };
}

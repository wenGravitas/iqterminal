import { describe, expect, it } from 'vitest';
import {
  applyObjectTreeFolderVisibility, clearObjectTreeDrawingName, createEmptyObjectTree, createMemoryObjectTreeStorage, createObjectTreeFolder, deleteObjectTreeFolder,
  findObjectTreeEntry, IQObjectTreeRepository, locateObjectTreeEntry, moveObjectTreeEntry, objectTreeFolderDepth,
  objectTreeDrawingIds, objectTreeFolderDrawingIds, objectTreeFolderVisibilityState, objectTreeStorageKey, parseIQObjectTreeCatalog, reconcileObjectTree,
  renameObjectTreeDrawing, renameObjectTreeFolder, reorderObjectTreeEntry, type IQObjectTreeCatalog, type IQObjectTreeStorage, type ObjectTreeEntry,
} from '../src/chart/object-tree';

describe('per-chart object tree catalog', () => {
  it('scopes metadata by panel, venue/market and symbol but not timeframe', () => {
    const one = objectTreeStorageKey('panel a', 'binance:perpetual', 'BTCUSDT');
    expect(one).toContain(encodeURIComponent('panel a'));
    expect(objectTreeStorageKey('panel a', 'binance:perpetual', 'BTCUSDT')).toBe(one);
    expect(objectTreeStorageKey('panel b', 'binance:perpetual', 'BTCUSDT')).not.toBe(one);
    expect(objectTreeStorageKey('panel a', 'hyperliquid:perpetual', 'BTC')).not.toBe(one);
  });

  it('round-trips nested folders and drawing aliases, and leaves unsupported data untouched', () => {
    const storage = createMemoryObjectTreeStorage();
    const key = objectTreeStorageKey('panel-1', 'binance:perpetual', 'BTCUSDT');
    const repo = new IQObjectTreeRepository(storage, key);
    let catalog = createObjectTreeFolder(repo.load(), null, 'folder-a', 'Levels')!;
    catalog = createObjectTreeFolder(catalog, 'folder-a', 'folder-b', 'Daily')!;
    if (catalog.entries[0]!.type === 'folder' && catalog.entries[0]!.children[0]?.type === 'folder') {
      catalog.entries[0]!.children[0].children.push({ type: 'drawing', drawingId: 'drawing-1', name: 'Weekly support' });
    }
    catalog = repo.save(catalog);
    expect(new IQObjectTreeRepository(storage, key).load()).toEqual(catalog);
    expect(objectTreeFolderDrawingIds(catalog.entries, 'folder-a')).toEqual(['drawing-1']);
    expect(locateObjectTreeEntry(catalog.entries, 'drawing', 'drawing-1')).toMatchObject({ parentId: 'folder-b', index: 0 });

    let unsupported = '{"version":99,"entries":[]}';
    let writes = 0;
    const preserve: IQObjectTreeStorage = { read: () => unsupported, write: (_key, value) => { writes++; unsupported = value; } };
    expect(() => new IQObjectTreeRepository(preserve, key).load()).toThrow(/unsupported/);
    expect(unsupported).toBe('{"version":99,"entries":[]}');
    expect(writes).toBe(0);
    expect(() => parseIQObjectTreeCatalog('{broken')).toThrow(/invalid JSON/);
  });

  it('reconciles removed drawing ids while retaining folder structure and appending new ids', () => {
    const catalog = {
      version: 1 as const, revision: 4,
      entries: [{ type: 'folder' as const, id: 'folder-a', name: 'Levels', children: [
        { type: 'drawing' as const, drawingId: 'gone' }, { type: 'drawing' as const, drawingId: 'kept' },
      ] }],
    };
    const next = reconcileObjectTree(catalog, ['kept', 'new']);
    expect(next.changed).toBe(true);
    expect(next.catalog.entries).toEqual([
      { type: 'folder', id: 'folder-a', name: 'Levels', children: [{ type: 'drawing', drawingId: 'kept' }] },
      { type: 'drawing', drawingId: 'new' },
    ]);
  });

  it('renames folders and drawing aliases without changing drawing ids', () => {
    let catalog = createObjectTreeFolder(createEmptyObjectTree(), null, 'folder-a', 'Plan')!;
    catalog = moveObjectTreeEntry({ ...catalog, entries: [...catalog.entries, { type: 'drawing', drawingId: 'draw-1' }] }, 'drawing', 'draw-1', 'folder-a', 0)!;
    catalog = renameObjectTreeFolder(catalog, 'folder-a', 'Execution')!;
    catalog = renameObjectTreeDrawing(catalog, 'draw-1', 'Sweep low')!;
    expect(catalog.entries[0]).toMatchObject({ name: 'Execution', children: [{ drawingId: 'draw-1', name: 'Sweep low' }] });
    catalog = clearObjectTreeDrawingName(catalog, 'draw-1')!;
    expect(catalog.entries[0]).toMatchObject({ children: [{ drawingId: 'draw-1' }] });
  });

  it('deletes a folder by promoting its children without deleting drawings', () => {
    let catalog = createObjectTreeFolder(createEmptyObjectTree(), null, 'parent', 'Plan')!;
    catalog = createObjectTreeFolder(catalog, 'parent', 'child', 'Intraday')!;
    catalog = { ...catalog, entries: [...catalog.entries, { type: 'drawing', drawingId: 'outside' }] };
    const parent = findObjectTreeEntry(catalog.entries, 'folder', 'parent');
    if (!parent || parent.type !== 'folder') throw new Error('test fixture folder missing');
    parent.children.push({ type: 'drawing', drawingId: 'drawing-1' });
    const child = findObjectTreeEntry(parent.children, 'folder', 'child');
    if (!child || child.type !== 'folder') throw new Error('test fixture child folder missing');
    child.children.push({ type: 'drawing', drawingId: 'drawing-2' });

    const next = deleteObjectTreeFolder(catalog, 'parent');
    expect(next?.entries).toEqual([
      { type: 'folder', id: 'child', name: 'Intraday', children: [{ type: 'drawing', drawingId: 'drawing-2' }] },
      { type: 'drawing', drawingId: 'drawing-1' },
      { type: 'drawing', drawingId: 'outside' },
    ]);
    expect(objectTreeDrawingIds(next?.entries ?? [])).toEqual(['drawing-2', 'drawing-1', 'outside']);
  });

  it('keeps reorder semantics, folder moves, cycle checks and the nesting limit bounded', () => {
    let catalog = createEmptyObjectTree();
    catalog = createObjectTreeFolder(catalog, null, 'a', 'A')!;
    catalog = createObjectTreeFolder(catalog, null, 'b', 'B')!;
    catalog = { ...catalog, entries: [...catalog.entries, { type: 'drawing', drawingId: 'd1' }, { type: 'drawing', drawingId: 'd2' }] };
    catalog = reorderObjectTreeEntry(catalog, 'drawing', 'd1', 1)!;
    expect(catalog.entries.slice(-2).map(entry => entry.type === 'drawing' ? entry.drawingId : '')).toEqual(['d2', 'd1']);
    catalog = moveObjectTreeEntry(catalog, 'folder', 'b', 'a', 0)!;
    expect(objectTreeFolderDepth(catalog.entries, 'b')).toBe(2);
    expect(moveObjectTreeEntry(catalog, 'folder', 'a', 'b', 0)).toBeNull();
    for (const id of ['c', 'd', 'e', 'f', 'g', 'h']) catalog = createObjectTreeFolder(catalog, id === 'c' ? 'b' : String.fromCharCode(id.charCodeAt(0) - 1), id, id)!;
    expect(objectTreeFolderDepth(catalog.entries, 'h')).toBe(8);
    expect(createObjectTreeFolder(catalog, 'h', 'too-deep', 'Too deep')).toBeNull();
    let nested: ObjectTreeEntry = { type: 'folder', id: 'level-9', name: '9', children: [] };
    for (let depth = 8; depth >= 1; depth--) nested = { type: 'folder', id: `level-${depth}`, name: String(depth), children: [nested] };
    expect(() => parseIQObjectTreeCatalog({ version: 1, revision: 0, entries: [nested] })).toThrow(/8 levels/);
  });

  it('applies recursive folder visibility as one explicit native batch without touching drawing metadata', () => {
    const catalog = createObjectTreeFolder(
      createObjectTreeFolder(
        createObjectTreeFolder(createEmptyObjectTree(), null, 'plans', 'Plans')!,
        'plans', 'intraday', 'Intraday',
      )!,
      'intraday', 'entries', 'Entries',
    )!;
    const withDrawings: IQObjectTreeCatalog = {
      ...catalog,
      entries: [...catalog.entries, { type: 'drawing', drawingId: 'outside' }],
    };
    const entries = JSON.parse(JSON.stringify(withDrawings.entries)) as ObjectTreeEntry[];
    const entriesFolder = findObjectTreeEntry(entries, 'folder', 'entries');
    if (!entriesFolder || entriesFolder.type !== 'folder') throw new Error('test fixture folder missing');
    entriesFolder.children.push(
      { type: 'drawing', drawingId: 'hidden', name: 'Hidden level' },
      { type: 'drawing', drawingId: 'shown' },
    );
    const drawings = new Map<string, { id: string; visible?: boolean; intervals: { from: string; to: string }; props: { iqterminalAnalysisInterval: string } }>([
      ['hidden', { id: 'hidden', visible: false, intervals: { from: '5m', to: '1h' }, props: { iqterminalAnalysisInterval: '4h' } }],
      ['shown', { id: 'shown', visible: true, intervals: { from: '1m', to: '15m' }, props: { iqterminalAnalysisInterval: '1h' } }],
      ['outside', { id: 'outside', visible: false, intervals: { from: '1m', to: '1m' }, props: { iqterminalAnalysisInterval: '1m' } }],
    ]);
    const originalMetadata = [...drawings.values()].map(({ id, intervals, props }) => ({ id, intervals, props }));
    const batches: Array<Array<{ id: string; patch: { visible: boolean } }>> = [];
    const getDrawing = (id: string) => drawings.get(id);
    const updateMany = (patches: readonly { id: string; patch: { visible: boolean } }[]) => {
      batches.push([...patches]);
      for (const { id, patch } of patches) {
        const drawing = drawings.get(id);
        if (drawing) drawings.set(id, { ...drawing, ...patch });
      }
    };

    expect(objectTreeFolderDrawingIds(entries, 'plans')).toEqual(['hidden', 'shown']);
    expect(objectTreeFolderVisibilityState(entries, 'plans', id => {
      const drawing = getDrawing(id);
      return drawing ? drawing.visible !== false : undefined;
    })).toBe('mixed');
    expect(applyObjectTreeFolderVisibility(entries, 'plans', true, getDrawing, updateMany)).toBe(2);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([
      { id: 'hidden', patch: { visible: true } },
      { id: 'shown', patch: { visible: true } },
    ]);
    expect([...drawings.values()].filter(drawing => drawing.id !== 'outside').every(drawing => drawing.visible)).toBe(true);
    expect(drawings.get('outside')?.visible).toBe(false);
    expect(objectTreeFolderVisibilityState(entries, 'plans', id => {
      const drawing = getDrawing(id);
      return drawing ? drawing.visible !== false : undefined;
    })).toBe('all');

    expect(applyObjectTreeFolderVisibility(entries, 'plans', false, getDrawing, updateMany)).toBe(2);
    expect(batches).toHaveLength(2);
    expect([...drawings.values()].filter(drawing => drawing.id !== 'outside').every(drawing => drawing.visible === false)).toBe(true);
    expect(objectTreeFolderVisibilityState(entries, 'plans', id => {
      const drawing = getDrawing(id);
      return drawing ? drawing.visible !== false : undefined;
    })).toBe('none');
    expect([...drawings.values()].map(({ id, intervals, props }) => ({ id, intervals, props }))).toEqual(originalMetadata);
  });

  it('skips missing drawings and does not submit empty folder batches', () => {
    let catalog = createObjectTreeFolder(createEmptyObjectTree(), null, 'levels', 'Levels')!;
    const folder = findObjectTreeEntry(catalog.entries, 'folder', 'levels');
    if (!folder || folder.type !== 'folder') throw new Error('test fixture folder missing');
    folder.children.push({ type: 'drawing', drawingId: 'gone' });
    let batches = 0;
    expect(applyObjectTreeFolderVisibility(catalog.entries, 'levels', true, () => undefined, () => { batches++; })).toBe(0);
    expect(batches).toBe(0);
    expect(objectTreeFolderVisibilityState(catalog.entries, 'levels', () => undefined)).toBe('none');
  });

  it('retains in-memory updates when browser storage writes fail', () => {
    const storage: IQObjectTreeStorage = { read: () => null, write: () => { throw new Error('quota denied'); } };
    const repo = new IQObjectTreeRepository(storage, 'tree-key');
    const saved = repo.save(createObjectTreeFolder(repo.load(), null, 'folder-a', 'Session only')!);
    expect(repo.error()?.message).toBe('quota denied');
    expect(repo.load()).toEqual(saved);
  });
});

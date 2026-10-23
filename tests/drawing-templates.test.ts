import { describe, expect, it } from 'vitest';
import {
  IQDrawingTemplateCatalogError,
  IQ_DRAWING_TEMPLATE_VERSION,
  IQ_DRAWING_TEMPLATE_STORAGE_KEY,
  IQDrawingTemplateRepository,
  createLocalStorageDrawingTemplateStorage,
  createMemoryDrawingTemplateStorage,
  parseIQDrawingTemplateCatalog,
  type IQDrawingTemplateSettings,
  type IQDrawingTemplateStorage,
} from '../src/chart/drawing-templates';

const snapshot: IQDrawingTemplateSettings = {
  nativeValues: {
    'style.color': '#f23645',
    'style.width': 2,
    'style.levels': [{ ratio: 0.5, color: '#089981', enabled: true }],
    'props.hostOptions': { enabled: true, tags: ['support', 'primary'] },
  },
  label: { present: true, value: '' },
  textColorExplicit: false,
  analysisInterval: '1h',
  visibility: { visible: false, intervals: { from: '1m', to: '15m' } },
};

function repository(storage: IQDrawingTemplateStorage, counter = { now: 10 }) {
  let nextId = 0;
  return new IQDrawingTemplateRepository(storage, () => counter.now++, () => `template-${++nextId}`);
}

describe('IQ drawing template catalog', () => {
  it('round-trips a versioned native snapshot, including an explicitly blank label', () => {
    const storage = createMemoryDrawingTemplateStorage();
    const first = repository(storage);
    const saved = first.saveTemplate('Support plan', 'horizontal-line', snapshot);

    expect(saved).toMatchObject({
      version: IQ_DRAWING_TEMPLATE_VERSION,
      revision: 1,
      templates: [{
        version: IQ_DRAWING_TEMPLATE_VERSION,
        id: 'template-1',
        tool: 'horizontal-line',
        nativeValues: snapshot.nativeValues,
        label: { present: true, value: '' },
        textColorExplicit: false,
        analysisInterval: '1h',
        visibility: snapshot.visibility,
        favorite: false,
        revision: 1,
      }],
    });
    expect(repository(storage).load()).toEqual(saved);

    const unset = first.saveTemplate('Unnamed', 'horizontal-ray', { ...snapshot, label: { present: false, value: '' } });
    expect(unset.templates.find(item => item.name === 'Unnamed')?.label).toEqual({ present: false, value: '' });
  });

  it('updates a same-name template in place and persists favorites and defaults by stable id', () => {
    const storage = createMemoryDrawingTemplateStorage();
    const store = repository(storage);
    const created = store.saveTemplate('Support plan', 'horizontal-line', snapshot);
    const id = created.templates[0]!.id;
    const favored = store.toggleFavorite(id);
    expect(favored.templates[0]).toMatchObject({ id, favorite: true, revision: 2 });
    const defaulted = store.setDefault('horizontal-line', id);

    const edited = store.saveTemplate('support PLAN', 'horizontal-line', {
      ...snapshot,
      nativeValues: { 'style.color': '#00aa88' },
      label: { present: true, value: 'Reclaim' },
    });
    expect(edited.templates).toHaveLength(1);
    expect(edited.templates[0]).toMatchObject({ id, favorite: true, revision: 3, name: 'Support plan', label: { present: true, value: 'Reclaim' } });
    expect(edited.defaults).toEqual(defaulted.defaults);
    expect(repository(storage).load()).toEqual(edited);
  });

  it('accepts Callout content templates and permits a default for every drawing tool', () => {
    const storage = createMemoryDrawingTemplateStorage();
    const store = repository(storage);
    const callout = store.saveTemplate('Callout note', 'callout', {
      ...snapshot,
      nativeValues: { 'style.color': '#26a69a', 'text.fontSize': 12 },
      label: { present: true, value: 'Earnings note' },
    });
    const id = callout.templates[0]!.id;

    store.toggleFavorite(id);
    expect(store.setDefault('callout', id).defaults).toContainEqual({ tool: 'callout', templateId: id, updatedAt: expect.any(Number) });
    expect(repository(storage).load().templates[0]).toMatchObject({
      tool: 'callout', favorite: true, label: { present: true, value: 'Earnings note' },
      nativeValues: { 'style.color': '#26a69a', 'text.fontSize': 12 },
    });

    const nativeTools = ['horizontal-line', 'horizontal-ray', 'trend-line', 'rectangle', 'fib-retracement', 'text', 'callout', 'long-position', 'short-position', 'date-range', 'price-range'];
    const defaults = repository(createMemoryDrawingTemplateStorage());
    for (const [index, tool] of nativeTools.entries()) {
      const saved = defaults.saveTemplate(`Tool ${index}`, tool, snapshot);
      defaults.setDefault(tool, saved.templates.find(template => template.tool === tool)!.id);
    }
    expect(defaults.load().defaults).toHaveLength(nativeTools.length);
  });

  it('renames and deletes templates while keeping defaults coherent', () => {
    const storage = createMemoryDrawingTemplateStorage();
    const store = repository(storage);
    const created = store.saveTemplate('Initial', 'text', snapshot);
    const id = created.templates[0]!.id;
    store.setDefault('text', id);
    expect(store.renameTemplate(id, 'Note style').templates[0]?.revision).toBe(2);
    expect(store.removeTemplate(id)).toMatchObject({ revision: 4, templates: [], defaults: [] });
  });

  it('preserves a malformed persistent value and does not overwrite it on load failure', () => {
    let stored = '{broken catalog';
    let writes = 0;
    const adapter = createLocalStorageDrawingTemplateStorage({
      getItem: key => key === IQ_DRAWING_TEMPLATE_STORAGE_KEY ? stored : null,
      setItem: (_key, value) => { writes++; stored = value; },
    });
    const store = new IQDrawingTemplateRepository(adapter);

    expect(() => store.load()).toThrow(IQDrawingTemplateCatalogError);
    expect(stored).toBe('{broken catalog');
    expect(writes).toBe(0);
  });

  it('treats older catalogs as stroke-colored and preserves explicit text color choices', () => {
    const legacy = parseIQDrawingTemplateCatalog({
      version: IQ_DRAWING_TEMPLATE_VERSION, revision: 1, defaults: [],
      templates: [{ version: IQ_DRAWING_TEMPLATE_VERSION, id: 'legacy', name: 'Legacy', tool: 'horizontal-line',
        favorite: false, revision: 1, createdAt: 1, updatedAt: 1, nativeValues: { 'text.color': '#ffffff' },
        label: { present: true, value: 'Support' }, analysisInterval: null, visibility: { visible: true, intervals: null } }],
    });
    expect(legacy.templates[0]?.textColorExplicit).toBe(false);
    const explicit = repository(createMemoryDrawingTemplateStorage()).saveTemplate('Explicit', 'horizontal-line', {
      ...snapshot, textColorExplicit: true,
    });
    expect(explicit.templates[0]?.textColorExplicit).toBe(true);
  });

  it('keeps a validated in-memory catalog usable after persistent writes fail', () => {
    const failingStorage: IQDrawingTemplateStorage = { read: () => null, write: () => { throw new Error('quota denied'); } };
    const store = repository(failingStorage);
    const saved = store.saveTemplate('Session only', 'rectangle', snapshot);

    expect(store.error()?.message).toBe('quota denied');
    expect(store.load()).toEqual(saved);
    expect(store.toggleFavorite(saved.templates[0]!.id).templates[0]?.favorite).toBe(true);
    expect(store.load().templates).toHaveLength(1);
  });

  it('rejects unsafe and unsupported native template paths without accepting partial records', () => {
    expect(() => parseIQDrawingTemplateCatalog({
      version: IQ_DRAWING_TEMPLATE_VERSION,
      revision: 0,
      templates: [{
        version: IQ_DRAWING_TEMPLATE_VERSION, id: 'unsafe', name: 'Unsafe', tool: 'text', favorite: false, revision: 1, createdAt: 1, updatedAt: 1,
        nativeValues: { 'text.value': 'Do not template content', 'props.constructor': {} },
        label: { present: false, value: '' }, analysisInterval: null, visibility: { visible: true, intervals: null },
      }], defaults: [],
    })).toThrow(IQDrawingTemplateCatalogError);
  });

  it('rejects a default that points to another tool or a deleted template', () => {
    const store = repository(createMemoryDrawingTemplateStorage());
    store.saveTemplate('Line', 'horizontal-line', snapshot);
    expect(() => store.setDefault('horizontal-ray', 'template-1')).toThrow('different tool');
    expect(() => store.setDefault('horizontal-line', 'missing')).toThrow('no longer exists');
  });
});

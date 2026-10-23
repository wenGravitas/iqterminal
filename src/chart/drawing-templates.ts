import { drawingSettingsSchema, readDrawingSettings, type Drawing, type DrawingIntervalRange } from 'openalgo-charts/draw';
import { intervals } from '../feed/protocol';

export const IQ_DRAWING_TEMPLATE_VERSION = 1 as const;
export const IQ_DRAWING_TEMPLATE_STORAGE_KEY = 'iqterminal:drawing-templates:v1';
const tools = new Set(['horizontal-line', 'horizontal-ray', 'trend-line', 'rectangle', 'fib-retracement', 'text', 'callout', 'long-position', 'short-position', 'date-range', 'price-range']);
const nativePath = /^(style|text|props)\.[A-Za-z][A-Za-z0-9_]{0,63}$/;
const unsafeKey = /^(?:__proto__|prototype|constructor)$/i;

export interface IQDrawingTemplateSettings {
  nativeValues: Record<string, unknown>;
  /** `present: false` means use the tool name; a present empty value is an explicit blank label. */
  label: { present: boolean; value: string };
  /** True when the drawing's text color was explicitly chosen by the user. */
  textColorExplicit: boolean;
  analysisInterval: string | null;
  visibility: { visible: boolean; intervals: DrawingIntervalRange | null };
}

export interface IQDrawingTemplateRecord extends IQDrawingTemplateSettings {
  version: typeof IQ_DRAWING_TEMPLATE_VERSION;
  id: string;
  name: string;
  tool: string;
  favorite: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface IQDrawingTemplateCatalog {
  version: typeof IQ_DRAWING_TEMPLATE_VERSION;
  revision: number;
  templates: IQDrawingTemplateRecord[];
  defaults: Array<{ tool: string; templateId: string; updatedAt: number }>;
}

export interface IQDrawingTemplateStorage {
  read(): string | null;
  write(value: string): void;
}

export class IQDrawingTemplateCatalogError extends Error {
  constructor(message: string) { super(message); this.name = 'IQDrawingTemplateCatalogError'; }
}

const emptyCatalog = (): IQDrawingTemplateCatalog => ({ version: IQ_DRAWING_TEMPLATE_VERSION, revision: 0, templates: [], defaults: [] });
const clone = <T>(value: T): T => structuredClone(value);

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IQDrawingTemplateCatalogError(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && value.trim().length === 0) || /[\u0000-\u001f]/.test(value)) {
    throw new IQDrawingTemplateCatalogError(`${name} is invalid`);
  }
  return value.trim();
}
function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new IQDrawingTemplateCatalogError(`${name} is invalid`);
  return value;
}
function scalar(value: unknown, name: string, depth = 0): unknown {
  if (depth > 5) throw new IQDrawingTemplateCatalogError(`${name} is too deeply nested`);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 64) throw new IQDrawingTemplateCatalogError(`${name} has too many values`);
    return value.map(item => scalar(item, name, depth + 1));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 64) throw new IQDrawingTemplateCatalogError(`${name} has too many properties`);
    for (const [key, item] of entries) {
      if (unsafeKey.test(key)) throw new IQDrawingTemplateCatalogError(`${name} contains an unsafe property`);
      out[key] = scalar(item, name, depth + 1);
    }
    return out;
  }
  throw new IQDrawingTemplateCatalogError(`${name} must contain JSON-safe scalar settings`);
}
function nativeValues(value: unknown): Record<string, unknown> {
  const source = record(value, 'nativeValues');
  const entries = Object.entries(source);
  if (entries.length > 64) throw new IQDrawingTemplateCatalogError('Too many native setting values');
  const out: Record<string, unknown> = {};
  for (const [path, item] of entries) {
    if (!nativePath.test(path) || path === 'text.value' || path.startsWith('props.iqterminal')) throw new IQDrawingTemplateCatalogError(`Unsupported native setting path: ${path}`);
    if (unsafeKey.test(path.split('.').at(-1)!)) throw new IQDrawingTemplateCatalogError(`Unsafe native setting path: ${path}`);
    out[path] = scalar(item, path);
  }
  return out;
}
function visibility(value: unknown) {
  const source = record(value, 'visibility');
  if (typeof source.visible !== 'boolean') throw new IQDrawingTemplateCatalogError('visibility.visible must be boolean');
  let range: DrawingIntervalRange | null = null;
  if (source.intervals !== null) {
    const intervalsRecord = record(source.intervals, 'visibility.intervals');
    const from = intervalsRecord.from === undefined ? undefined : text(intervalsRecord.from, 'visibility.intervals.from', 12);
    const to = intervalsRecord.to === undefined ? undefined : text(intervalsRecord.to, 'visibility.intervals.to', 12);
    if ((from && !intervals.includes(from as typeof intervals[number])) || (to && !intervals.includes(to as typeof intervals[number]))) {
      throw new IQDrawingTemplateCatalogError('visibility.intervals contains an unsupported interval');
    }
    if (from && to && intervals.indexOf(from as typeof intervals[number]) > intervals.indexOf(to as typeof intervals[number])) {
      throw new IQDrawingTemplateCatalogError('visibility.intervals range is reversed');
    }
    range = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  return { visible: source.visible, intervals: range };
}
function settings(source: Record<string, unknown>): IQDrawingTemplateSettings {
  const label = record(source.label, 'label');
  if (typeof label.present !== 'boolean' || typeof label.value !== 'string' || label.value.length > 256 || /[\u0000-\u001f]/.test(label.value)) {
    throw new IQDrawingTemplateCatalogError('label is invalid');
  }
  let analysisInterval: string | null = null;
  if (source.analysisInterval !== null) {
    analysisInterval = text(source.analysisInterval, 'analysisInterval', 12);
    if (!intervals.includes(analysisInterval as typeof intervals[number])) throw new IQDrawingTemplateCatalogError('analysisInterval is unsupported');
  }
  const textColorExplicit = source.textColorExplicit === undefined ? false : source.textColorExplicit;
  if (typeof textColorExplicit !== 'boolean') throw new IQDrawingTemplateCatalogError('textColorExplicit is invalid');
  return { nativeValues: nativeValues(source.nativeValues), label: { present: label.present, value: label.value }, textColorExplicit, analysisInterval, visibility: visibility(source.visibility) };
}

export function parseIQDrawingTemplateCatalog(input: unknown): IQDrawingTemplateCatalog {
  let parsed = input;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); } catch { throw new IQDrawingTemplateCatalogError('Saved drawing templates contain invalid JSON; the stored record was left untouched.'); }
  }
  const source = record(parsed, 'drawing template catalog');
  if (source.version !== IQ_DRAWING_TEMPLATE_VERSION) throw new IQDrawingTemplateCatalogError('Saved drawing template version is unsupported; the stored record was left untouched.');
  const revision = integer(source.revision, 'catalog revision');
  if (!Array.isArray(source.templates) || source.templates.length > 200) throw new IQDrawingTemplateCatalogError('Template list is invalid');
  const templates = source.templates.map(item => {
    const template = record(item, 'drawing template');
    const tool = text(template.tool, 'tool', 100);
    if (!tools.has(tool) || template.version !== IQ_DRAWING_TEMPLATE_VERSION) throw new IQDrawingTemplateCatalogError('Template version or drawing tool is unsupported');
    if (typeof template.favorite !== 'boolean') throw new IQDrawingTemplateCatalogError('Template favorite state is invalid');
    return {
      version: IQ_DRAWING_TEMPLATE_VERSION,
      id: text(template.id, 'template id', 100),
      name: text(template.name, 'template name', 48),
      tool,
      ...settings(template),
      favorite: template.favorite,
      revision: integer(template.revision, 'template revision'),
      createdAt: integer(template.createdAt, 'template createdAt'),
      updatedAt: integer(template.updatedAt, 'template updatedAt'),
    };
  });
  if (new Set(templates.map(item => item.id)).size !== templates.length) throw new IQDrawingTemplateCatalogError('Duplicate drawing template id');
  const defaultsRaw = source.defaults ?? [];
  if (!Array.isArray(defaultsRaw) || defaultsRaw.length > tools.size) throw new IQDrawingTemplateCatalogError('Template defaults are invalid');
  const defaults = defaultsRaw.map(item => {
    const entry = record(item, 'drawing template default');
    const tool = text(entry.tool, 'default tool', 100);
    const templateId = text(entry.templateId, 'default template id', 100);
    if (!tools.has(tool) || !templates.some(template => template.id === templateId && template.tool === tool)) throw new IQDrawingTemplateCatalogError('Default references a missing or incompatible template');
    return { tool, templateId, updatedAt: integer(entry.updatedAt, 'default updatedAt') };
  });
  if (new Set(defaults.map(item => item.tool)).size !== defaults.length) throw new IQDrawingTemplateCatalogError('Duplicate default tool');
  return { version: IQ_DRAWING_TEMPLATE_VERSION, revision, templates, defaults };
}

export function captureIQDrawingTemplateSettings(drawing: Drawing): IQDrawingTemplateSettings {
  const props = drawing.props ?? {};
  const read = readDrawingSettings(drawing, drawingSettingsSchema(drawing.tool));
  const values = Object.fromEntries(Object.entries(read).filter(([path, value]) =>
    value !== undefined && nativePath.test(path) && path !== 'text.value' && !path.startsWith('props.iqterminal'),
  ));
  return {
    nativeValues: values,
    label: {
      present: props.iqterminalLabelState === 'custom',
      value: typeof props.iqterminalLabel === 'string' ? props.iqterminalLabel : '',
    },
    textColorExplicit: props.iqterminalLabelTextColorExplicit === true,
    analysisInterval: typeof props.iqterminalAnalysisInterval === 'string' && props.iqterminalAnalysisInterval ? props.iqterminalAnalysisInterval : null,
    visibility: { visible: drawing.visible !== false, intervals: drawing.intervals ? clone(drawing.intervals) : null },
  };
}

export class IQDrawingTemplateRepository {
  private catalog?: IQDrawingTemplateCatalog;
  private readonly listeners = new Set<(catalog: IQDrawingTemplateCatalog) => void>();
  private persistenceError?: Error;

  constructor(private readonly storage: IQDrawingTemplateStorage, private readonly now: () => number = Date.now, private readonly id: () => string = () => crypto.randomUUID()) {}

  load() {
    if (this.catalog) return clone(this.catalog);
    const raw = this.storage.read();
    this.catalog = raw === null ? emptyCatalog() : parseIQDrawingTemplateCatalog(raw);
    return clone(this.catalog);
  }
  error() { return this.persistenceError; }
  subscribe(listener: (catalog: IQDrawingTemplateCatalog) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  saveTemplate(name: string, tool: string, snapshot: IQDrawingTemplateSettings) {
    const cleanName = text(name, 'template name', 48);
    if (!tools.has(tool)) throw new IQDrawingTemplateCatalogError('Template drawing tool is unsupported');
    const cleanSettings = settings(snapshot as unknown as Record<string, unknown>);
    const current = this.load();
    const existing = current.templates.find(template => template.tool === tool && template.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase());
    const time = Math.max(existing?.updatedAt ?? 0, integer(this.now(), 'current time'));
    const template: IQDrawingTemplateRecord = existing
      ? { ...existing, ...cleanSettings, revision: existing.revision + 1, updatedAt: time }
      : { version: IQ_DRAWING_TEMPLATE_VERSION, id: text(this.id(), 'template id', 100), name: cleanName, tool, ...cleanSettings,
        favorite: false, revision: 1, createdAt: time, updatedAt: time };
    const templates = existing ? current.templates.map(item => item.id === existing.id ? template : item) : [...current.templates, template];
    return this.commit({ ...current, templates });
  }

  renameTemplate(id: string, name: string) {
    const cleanName = text(name, 'template name', 48), current = this.load();
    const target = this.find(current, id);
    if (current.templates.some(item => item.id !== id && item.tool === target.tool && item.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) throw new IQDrawingTemplateCatalogError('A template with this name already exists for this tool');
    const updatedAt = Math.max(target.updatedAt, integer(this.now(), 'current time'));
    return this.commit({ ...current, templates: current.templates.map(item => item.id === id ? { ...item, name: cleanName, revision: item.revision + 1, updatedAt } : item) });
  }

  removeTemplate(id: string) {
    const current = this.load(); this.find(current, id);
    return this.commit({ ...current, templates: current.templates.filter(item => item.id !== id), defaults: current.defaults.filter(item => item.templateId !== id) });
  }

  toggleFavorite(id: string) {
    const current = this.load(), target = this.find(current, id);
    const updatedAt = Math.max(target.updatedAt, integer(this.now(), 'current time'));
    return this.commit({ ...current, templates: current.templates.map(item => item.id === id ? { ...item, favorite: !item.favorite, revision: item.revision + 1, updatedAt } : item) });
  }

  setDefault(tool: string, templateId: string | null) {
    if (!tools.has(tool)) throw new IQDrawingTemplateCatalogError('Template drawing tool is unsupported');
    const current = this.load();
    const selected = templateId === null ? undefined : this.find(current, templateId);
    if (selected && selected.tool !== tool) throw new IQDrawingTemplateCatalogError('Default template belongs to a different tool');
    const defaults = current.defaults.filter(item => item.tool !== tool);
    if (selected) defaults.push({ tool, templateId: selected.id, updatedAt: Math.max(selected.updatedAt, integer(this.now(), 'current time')) });
    return this.commit({ ...current, defaults });
  }

  private find(catalog: IQDrawingTemplateCatalog, id: string) {
    const target = catalog.templates.find(item => item.id === id);
    if (!target) throw new IQDrawingTemplateCatalogError('Saved drawing template no longer exists');
    return target;
  }

  private commit(candidate: IQDrawingTemplateCatalog) {
    const current = this.load();
    const validated = parseIQDrawingTemplateCatalog({ ...candidate, version: IQ_DRAWING_TEMPLATE_VERSION, revision: current.revision + 1 });
    this.catalog = validated;
    try { this.storage.write(JSON.stringify(validated)); this.persistenceError = undefined; }
    catch (error) { this.persistenceError = error instanceof Error ? error : new Error(String(error)); }
    const detached = clone(validated);
    for (const listener of this.listeners) listener(clone(detached));
    return detached;
  }
}

export function createLocalStorageDrawingTemplateStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): IQDrawingTemplateStorage {
  return {
    read: () => storage.getItem(IQ_DRAWING_TEMPLATE_STORAGE_KEY),
    write: value => storage.setItem(IQ_DRAWING_TEMPLATE_STORAGE_KEY, value),
  };
}

export function createMemoryDrawingTemplateStorage(): IQDrawingTemplateStorage {
  let value: string | null = null;
  return { read: () => value, write: next => { value = next; } };
}

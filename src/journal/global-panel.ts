import './global-panel.css';
import { formatDateTime, getDisplayTimezone, TIMEZONE_EVENT } from '../timezone';
import { zonedStringToUtcSeconds } from 'openalgo-charts';
import type { IDockviewPanelProps, IContentRenderer } from 'dockview-core';
import { JOURNAL_LIMITS, marketIdentity, type ChartSnapshot, type JournalAsset, type JournalAttachment, type JournalDraft, type JournalEntry, type JournalQuery } from './model';
import { imageAsset, type JournalRepository } from './repository';
import { downloadBlob, exportJournal, importJournal } from './import-export';
import { renderJournalMarkdown } from './markdown';

export interface GlobalJournalOpenOptions {
  entryId?: string;
  attachmentId?: string;
  draftId?: string;
  entryAt?: number;
  relatedEntryIds?: string[];
}

export interface GlobalJournalPanelOptions {
  onPublished?: (entry: JournalEntry) => void;
  restore?: (snapshot: ChartSnapshot) => Promise<unknown>;
  now?: () => number;
}

type ImageAttachment = JournalAttachment & { kind: 'image' };
type AssetUrl = { url: string; assetId: string };

const html = (tag: string, className?: string) => { const node = document.createElement(tag); if (className) node.className = className; return node; };
const action = (label: string, onClick: () => void, className = '') => {
  const button = html('button', className) as HTMLButtonElement;
  button.type = 'button'; button.textContent = label; button.addEventListener('click', onClick); return button;
};
const dateStep = (label: string, direction: 'previous' | 'next', onClick: () => void) => {
  const button = action(label, onClick, 'journal-v2-day-step'); button.setAttribute('aria-label', label); button.title = label; button.textContent = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 12 12'); svg.setAttribute('width', '12'); svg.setAttribute('height', '12'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', direction === 'previous' ? 'M7.5 2.5 3.5 6l4 3.5' : 'M4.5 2.5 8.5 6l-4 3.5');
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.2');
  svg.append(path); button.append(svg); return button;
};
const labeled = (label: string, control: HTMLElement, className = '') => {
  const root = html('label', `journal-v2-field ${className}`), text = html('span'); text.textContent = label;
  control.setAttribute('aria-label', label); root.append(text, control); return root;
};
const asMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const uid = () => crypto.randomUUID();
const pad = (n: number) => String(n).padStart(2, '0');

export function calendarDayAt(epochMs: number, timezone = getDisplayTimezone()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(epochMs);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftCalendarDay(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + offset));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function journalDayRange(day: string, timezone = getDisplayTimezone()) {
  const from = zonedStringToUtcSeconds(`${day}T00:00:00`, timezone);
  const to = zonedStringToUtcSeconds(`${shiftCalendarDay(day, 1)}T00:00:00`, timezone);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw Error('That calendar day is unavailable in the selected timezone');
  return { from: Math.round(from * 1000), to: Math.round(to * 1000) };
}

function dateTimeValue(epochMs: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(epochMs);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function parseDateTimeValue(value: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw Error('Enter a valid entry date and time');
  const seconds = zonedStringToUtcSeconds(`${value}:00`, timezone);
  if (!Number.isFinite(seconds)) throw Error('That time is unavailable in the selected timezone');
  return Math.round(seconds * 1000);
}

function dayLabel(day: string, timezone: string) {
  const { from } = journalDayRange(day, timezone);
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(from);
}

function timeLabel(epochMs: number, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(epochMs);
}

function entryContext(entry: JournalEntry) {
  return entry.attachments.find(attachment => attachment.kind === 'chart-capture' && attachment.chartCapture)?.chartCapture;
}

function contextLabel(attachment: JournalAttachment) {
  const capture = attachment.chartCapture;
  if (!capture) return 'Chart context unavailable';
  const market = capture.snapshot.market;
  return `${market.venue} · ${market.market} · ${market.symbol}`;
}

function escapeMarkdownAlt(value: string) { return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]'); }

/** Standalone native DOM Dockview content; does not own chart panels or exchange connections. */
export class GlobalJournalPanel implements IContentRenderer {
  readonly element = html('section', 'global-journal-panel');

  private readonly feed: HTMLElement;
  private readonly timeline: HTMLElement;
  private readonly drafts: HTMLElement;
  private readonly status: HTMLElement;
  private readonly feedStatus: HTMLElement;
  private readonly headingDate: HTMLElement;
  private readonly dateInput: HTMLInputElement;
  private readonly scopeSelect: HTMLSelectElement;
  private readonly searchInput: HTMLInputElement;
  private readonly kindFilter: HTMLInputElement;
  private readonly tagFilter: HTMLInputElement;
  private readonly instrumentFilter: HTMLSelectElement;
  private readonly filterClear: HTMLButtonElement;
  private readonly sortButton: HTMLButtonElement;
  private readonly dialog: HTMLDialogElement;
  private readonly titleInput: HTMLInputElement;
  private readonly entryTimeInput: HTMLInputElement;
  private readonly kindInput: HTMLInputElement;
  private readonly tagsInput: HTMLInputElement;
  private readonly bodyInput: HTMLTextAreaElement;
  private readonly bodyPreview: HTMLElement;
  private readonly attachmentList: HTMLElement;
  private readonly composerStatus: HTMLElement;
  private readonly conflictAction: HTMLButtonElement;
  private readonly imageInput: HTMLInputElement;
  private readonly uploadButton: HTMLButtonElement;
  private readonly previewToggle: HTMLButtonElement;

  private selectedDay: string;
  private todayDay: string;
  private sort: 'newest' | 'oldest' = 'newest';
  private pageGeneration = 0;
  private composerGeneration = 0;
  private entries: JournalEntry[] = [];
  private optionsLoaded = false;
  private filterOptionsCapped = false;
  private kinds = new Set<string>();
  private tags = new Set<string>();
  private instruments = new Map<string, string>();
  private imageObserver?: IntersectionObserver;
  private previewObserver?: IntersectionObserver;
  private feedUrls = new Map<string, AssetUrl>();
  private previewUrls = new Map<string, AssetUrl>();
  private localAssets = new Map<string, JournalAsset>();
  private release: () => void;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private autosaveTimer?: ReturnType<typeof setTimeout>;
  private midnightTimer?: ReturnType<typeof setTimeout>;
  private draft?: JournalDraft;
  private draftDirty = false;
  private previewing = false;
  private savingDraft?: Promise<void>;
  private blockAutosaveRetry = false;
  private closed = false;
  private readonly now: () => number;
  private readonly timezoneChanged = () => this.onTimezoneChanged();
  private readonly visibilityChanged = () => this.onVisibilityChanged();
  private params?: IDockviewPanelProps;

  constructor(private readonly repository: JournalRepository, private readonly options: GlobalJournalPanelOptions = {}) {
    this.now = options.now ?? Date.now;
    this.todayDay = calendarDayAt(this.now()); this.selectedDay = this.todayDay;
    this.element.setAttribute('aria-label', 'Global Journal daily feed');

    const header = html('header', 'journal-v2-header');
    const titleBlock = html('div', 'journal-v2-title-block');
    const title = html('h1'); title.textContent = 'Global Journal';
    const timezone = html('span', 'journal-v2-timezone'); timezone.textContent = getDisplayTimezone();
    titleBlock.append(title, timezone);
    const add = action('Add entry', () => this.compose({ entryAt: this.now() }), 'journal-v2-add');
    const tools = html('details', 'journal-v2-tools');
    const summary = html('summary'); summary.textContent = 'Storage and backup';
    const toolActions = html('div', 'journal-v2-tool-actions');
    const importInput = html('input') as HTMLInputElement; importInput.type = 'file'; importInput.accept = 'application/json,.json'; importInput.hidden = true; importInput.setAttribute('aria-label', 'Import journal backup');
    importInput.addEventListener('change', () => {
      const file = importInput.files?.[0]; if (!file) return;
      void this.task(async () => { const result = await importJournal(repository, file); this.status.textContent = `Imported ${result.added} entries and ${result.draftsAdded} drafts; skipped ${result.duplicates + result.draftsDuplicates} duplicates.`; importInput.value = ''; await this.refresh(true); });
    });
    toolActions.append(
      action('Export matches and drafts', () => void this.task(() => this.exportCurrent())),
      action('Import backup', () => importInput.click()),
      action('Request persistent storage', () => void this.task(async () => { this.status.textContent = await repository.persist() ? 'The browser granted persistent storage. Keep exported backups too.' : 'The browser did not grant persistent storage. Keep exported backups.'; })),
      action('Storage use', () => void this.task(async () => { const use = await repository.usage(); this.status.textContent = `${use.entries} entries · ${use.drafts ?? 0} drafts · ${use.assets} images · ${(use.bytes / 1048576).toFixed(1)} MB stored${use.quota ? ` · ${(100 * (use.browserUsage ?? 0) / use.quota).toFixed(1)}% of origin quota` : ''}.`; })),
      importInput,
    );
    tools.append(summary, toolActions); header.append(titleBlock, add, tools);

    const dateBar = html('nav', 'journal-v2-datebar'); dateBar.setAttribute('aria-label', 'Journal date navigation');
    dateBar.append(dateStep('Previous day', 'previous', () => this.selectDay(shiftCalendarDay(this.selectedDay, -1))));
    this.dateInput = html('input') as HTMLInputElement; this.dateInput.type = 'date'; this.dateInput.value = this.selectedDay; this.dateInput.setAttribute('aria-label', 'Selected journal date');
    this.headingDate = html('span', 'journal-v2-day-label');
    this.dateInput.addEventListener('change', () => { if (this.dateInput.value) this.selectDay(this.dateInput.value); });
    dateBar.append(this.dateInput, this.headingDate, action('Today', () => this.selectDay(this.todayDay), 'journal-v2-today'));
    dateBar.append(dateStep('Next day', 'next', () => this.selectDay(shiftCalendarDay(this.selectedDay, 1))));
    this.sortButton = action('Newest first', () => { this.sort = this.sort === 'newest' ? 'oldest' : 'newest'; this.sortButton.textContent = this.sort === 'newest' ? 'Newest first' : 'Oldest first'; this.sortButton.setAttribute('aria-pressed', String(this.sort === 'oldest')); void this.refresh(); }, 'journal-v2-sort');
    this.sortButton.setAttribute('aria-pressed', 'false'); dateBar.append(this.sortButton);

    const filterBar = html('section', 'journal-v2-filters');
    this.scopeSelect = html('select') as HTMLSelectElement; this.scopeSelect.append(new Option('Selected day', 'day'), new Option('All dates', 'all'));
    this.searchInput = html('input') as HTMLInputElement; this.searchInput.type = 'search'; this.searchInput.placeholder = 'Search all entry text';
    this.kindFilter = html('input') as HTMLInputElement; this.kindFilter.type = 'text'; this.kindFilter.placeholder = 'Any kind'; this.kindFilter.setAttribute('list', 'journal-v2-kinds');
    this.tagFilter = html('input') as HTMLInputElement; this.tagFilter.type = 'text'; this.tagFilter.placeholder = 'Exact tag'; this.tagFilter.setAttribute('list', 'journal-v2-tags');
    this.instrumentFilter = html('select') as HTMLSelectElement; this.instrumentFilter.append(new Option('All instruments', ''));
    filterBar.append(labeled('Date scope', this.scopeSelect), labeled('Search', this.searchInput), labeled('Kind', this.kindFilter), labeled('Tag', this.tagFilter), labeled('Chart instrument', this.instrumentFilter));
    const lists = html('div', 'journal-v2-datalists');
    const kindList = html('datalist') as HTMLDataListElement; kindList.id = 'journal-v2-kinds';
    const tagList = html('datalist') as HTMLDataListElement; tagList.id = 'journal-v2-tags'; lists.append(kindList, tagList);
    this.filterClear = action('Clear filters', () => this.clearFilters(), 'journal-v2-clear'); this.filterClear.hidden = true; filterBar.append(this.filterClear, lists);
    for (const control of [this.scopeSelect, this.searchInput, this.kindFilter, this.tagFilter, this.instrumentFilter]) control.addEventListener('input', () => this.scheduleRefresh());
    this.scopeSelect.addEventListener('change', () => this.scheduleRefresh()); this.instrumentFilter.addEventListener('change', () => this.scheduleRefresh());

    this.status = html('p', 'journal-v2-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.feedStatus = html('p', 'journal-v2-feed-status'); this.feedStatus.setAttribute('role', 'status');
    this.drafts = html('section', 'journal-v2-drafts'); this.drafts.setAttribute('aria-label', 'Saved journal drafts');
    this.timeline = html('div', 'journal-v2-timeline'); this.timeline.setAttribute('aria-label', 'Journal entries');
    this.feed = html('main', 'journal-v2-feed'); this.feed.append(this.drafts, this.feedStatus, this.timeline);
    this.element.append(header, dateBar, filterBar, this.status, this.feed);

    const built = this.buildComposer();
    this.dialog = built.dialog; this.titleInput = built.title; this.entryTimeInput = built.entryTime; this.kindInput = built.kind; this.tagsInput = built.tags; this.bodyInput = built.body; this.bodyPreview = built.preview; this.attachmentList = built.attachments; this.composerStatus = built.status; this.conflictAction = built.conflict; this.imageInput = built.imageInput; this.uploadButton = built.upload; this.previewToggle = built.previewToggle;
    this.element.append(this.dialog);
    this.release = repository.subscribe(() => { if (!this.closed) { this.optionsLoaded = false; this.scheduleRefresh(); } });
    window.addEventListener(TIMEZONE_EVENT, this.timezoneChanged);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.updateDateLabel(); this.scheduleMidnight();
    void this.refresh(true);
  }

  open(options: GlobalJournalOpenOptions = {}) {
    if (options.draftId) { void this.resumeDraft(options.draftId); return; }
    if (options.entryId) { void this.revealEntry(options.entryId, options.entryAt, options.attachmentId); return; }
    if (options.entryAt !== undefined || options.relatedEntryIds?.length) { this.compose({ entryAt: options.entryAt ?? this.now(), relatedEntryIds: options.relatedEntryIds }); return; }
    void this.refresh();
  }

  init(params: IDockviewPanelProps) {
    this.params = params;
    params.api.setTitle('Global Journal');
  }

  dispose() {
    if (this.closed) return;
    const pendingDraft = this.draft && (this.draftDirty || Boolean(this.savingDraft)) ? this.flushDraft().catch(() => undefined) : undefined;
    this.closed = true; this.release(); window.removeEventListener(TIMEZONE_EVENT, this.timezoneChanged);
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    clearTimeout(this.refreshTimer); clearTimeout(this.autosaveTimer); clearTimeout(this.midnightTimer);
    this.pageGeneration++; this.composerGeneration++; this.imageObserver?.disconnect(); this.previewObserver?.disconnect();
    this.revokeUrls(this.feedUrls); this.revokeUrls(this.previewUrls);
    if (pendingDraft) void pendingDraft.finally(() => this.localAssets.clear()); else this.localAssets.clear();
    if (this.dialog.open) this.dialog.close(); this.element.remove();
  }

  private buildComposer() {
    const dialog = html('dialog', 'journal-v2-dialog') as HTMLDialogElement;
    dialog.setAttribute('aria-labelledby', 'journal-v2-composer-title');
    const form = html('form', 'journal-v2-composer') as HTMLFormElement; form.method = 'dialog';
    const header = html('header', 'journal-v2-composer-header');
    const heading = html('h2'); heading.id = 'journal-v2-composer-title'; heading.textContent = 'Journal entry';
    const status = html('p', 'journal-v2-composer-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    header.append(heading, status);
    const title = html('input') as HTMLInputElement; title.type = 'text'; title.maxLength = 240;
    const entryTime = html('input') as HTMLInputElement; entryTime.type = 'datetime-local';
    const kind = html('input') as HTMLInputElement; kind.type = 'text'; kind.maxLength = JOURNAL_LIMITS.kind; kind.setAttribute('list', 'journal-v2-kinds');
    const tags = html('input') as HTMLInputElement; tags.type = 'text'; tags.placeholder = 'Separate tags with commas';
    const fields = html('div', 'journal-v2-composer-fields');
    fields.append(labeled('Title (optional)', title), labeled('Entry time', entryTime), labeled('Kind', kind), labeled('Tags', tags));
    const toolbar = html('div', 'journal-v2-markdown-toolbar');
    const body = html('textarea') as HTMLTextAreaElement; body.maxLength = JOURNAL_LIMITS.note; body.rows = 12; body.setAttribute('spellcheck', 'true'); body.setAttribute('aria-label', 'Entry body in Markdown');
    const insert = (before: string, after = '') => {
      const start = body.selectionStart, end = body.selectionEnd, selected = body.value.slice(start, end);
      body.setRangeText(`${before}${selected || (after ? 'text' : '')}${after}`, start, end, 'select'); body.focus();
      if (!selected && after) body.setSelectionRange(start + before.length, start + before.length + 4);
      body.dispatchEvent(new Event('input', { bubbles: true }));
    };
    for (const [label, before, after] of [['Bold', '**', '**'], ['Italic', '*', '*'], ['Code', '`', '`'], ['Heading', '## ', ''], ['Link', '[', '](https://)'], ['List item', '- ', '']] as const) toolbar.append(action(label, () => insert(before, after)));
    const bodyWrap = html('div', 'journal-v2-body-wrap');
    const editor = html('div', 'journal-v2-editor-pane'); editor.append(toolbar, body);
    const preview = html('article', 'journal-v2-preview'); preview.hidden = true; preview.setAttribute('aria-label', 'Markdown preview');
    bodyWrap.append(editor, preview);
    const imageInput = html('input') as HTMLInputElement; imageInput.type = 'file'; imageInput.accept = 'image/png,image/jpeg,image/webp'; imageInput.multiple = true; imageInput.hidden = true; imageInput.setAttribute('aria-label', 'Upload journal images');
    const upload = action('Add images', () => imageInput.click());
    const previewToggle = action('Preview Markdown', () => {
      const showing = !preview.hidden; preview.hidden = showing; editor.hidden = !showing; previewToggle.textContent = showing ? 'Preview Markdown' : 'Edit Markdown';
      this.previewing = !showing;
      if (!showing) this.renderComposerPreview();
    });
    const attachments = html('section', 'journal-v2-attachments'); attachments.setAttribute('aria-label', 'Image attachments');
    const drop = action('Drop or paste images here, or choose files', () => imageInput.click(), 'journal-v2-dropzone'); drop.setAttribute('aria-label', 'Add images: choose files, drop images, or paste an image into the editor');
    drop.addEventListener('dragover', event => { event.preventDefault(); drop.dataset.dragging = 'true'; });
    drop.addEventListener('dragleave', () => { delete drop.dataset.dragging; });
    drop.addEventListener('drop', event => { event.preventDefault(); delete drop.dataset.dragging; void this.addImageFiles([...(event.dataTransfer?.files ?? [])]); });
    body.addEventListener('paste', event => {
      const files = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
      if (files.some(file => file.type.startsWith('image/'))) { event.preventDefault(); void this.addImageFiles(files); }
    });
    imageInput.addEventListener('change', () => { const files = [...(imageInput.files ?? [])]; imageInput.value = ''; void this.addImageFiles(files); });
    attachments.append(drop);
    const actions = html('footer', 'journal-v2-composer-actions');
    const conflict = action('Save edits as a new entry', () => this.saveConflictAsNew()); conflict.hidden = true;
    const close = action('Keep as draft and close', () => void this.closeComposer(true));
    const publish = html('button', 'journal-v2-publish') as HTMLButtonElement; publish.type = 'button'; publish.textContent = 'Publish entry'; publish.addEventListener('click', () => void this.publishDraft());
    const removeDraft = action('Discard draft', () => void this.discardActiveDraft(), 'journal-v2-discard');
    actions.append(conflict, close, removeDraft, publish);
    form.append(header, fields, bodyWrap, attachments, upload, previewToggle, imageInput, actions);
    dialog.append(form);
    dialog.addEventListener('cancel', event => { event.preventDefault(); void this.closeComposer(true); });
    dialog.addEventListener('click', event => { if (event.target === dialog) void this.closeComposer(true); });
    for (const input of [title, entryTime, kind, tags, body]) input.addEventListener('input', () => this.onComposerInput());
    return { dialog, title, entryTime, kind, tags, body, preview, attachments, status, conflict, imageInput, upload, previewToggle };
  }

  private async refresh(loadOptions = false) {
    const generation = ++this.pageGeneration;
    try {
      if (loadOptions || !this.optionsLoaded) await this.loadFilterOptions();
      if (generation !== this.pageGeneration || this.closed) return;
      const query = this.query();
      const [entries, drafts] = await Promise.all([this.repository.entries({ ...query, limit: 100 }), this.repository.drafts()]);
      if (generation !== this.pageGeneration || this.closed) return;
      this.entries = entries; this.renderEntries(entries); this.renderDrafts(drafts);
      const capNotice = this.filterOptionsCapped ? ' · Filter choices cover the newest 10,000 entries' : '';
      this.feedStatus.textContent = this.resultIsCapped(entries) ? `The journal search reached its scan limit. Narrow filters to continue.${capNotice}` : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · ${this.scopeSelect.value === 'all' ? 'all dates' : dayLabel(this.selectedDay, getDisplayTimezone())}${capNotice}`;
      this.updateClearButton();
    } catch (error) {
      if (generation === this.pageGeneration) this.feedStatus.textContent = `Journal could not be loaded: ${asMessage(error)}. Saved records remain in storage.`;
    }
  }

  private query(): JournalQuery {
    const dateRange = this.scopeSelect.value === 'all' ? {} : journalDayRange(this.selectedDay, getDisplayTimezone());
    const tag = this.tagFilter.value.trim().replace(/^#/, '');
    return {
      ...dateRange,
      ...(this.searchInput.value.trim() ? { text: this.searchInput.value.trim() } : {}),
      ...(this.kindFilter.value.trim() ? { kind: this.kindFilter.value.trim() } : {}),
      ...(tag ? { tag } : {}),
      ...(this.instrumentFilter.value ? { instrument: this.instrumentFilter.value } : {}),
      order: this.sort,
    };
  }

  private async loadFilterOptions() {
    const records: JournalEntry[] = [];
    let before: JournalQuery['before']; this.filterOptionsCapped = false;
    while (records.length < 10_000) {
      const batch = await this.repository.entries({ order: 'newest', ...(before ? { before } : {}), limit: 500 });
      records.push(...batch);
      if (this.resultIsCapped(batch)) { this.filterOptionsCapped = true; break; }
      if (batch.length < 500) break;
      const last = batch.at(-1)!; before = { entryAt: last.entryAt, id: last.id };
    }
    if (records.length >= 10_000) {
      const last = records.at(-1)!;
      const more = await this.repository.entries({ order: 'newest', before: { entryAt: last.entryAt, id: last.id }, limit: 1 });
      this.filterOptionsCapped = more.length > 0 || this.resultIsCapped(more);
    }
    this.kinds.clear(); this.tags.clear(); this.instruments.clear();
    for (const entry of records) {
      this.kinds.add(entry.kind);
      for (const tag of entry.tags) this.tags.add(tag);
      for (const attachment of entry.attachments) {
        const capture = attachment.chartCapture;
        if (attachment.kind !== 'chart-capture' || !capture) continue;
        const identity = marketIdentity(capture.snapshot.market);
        this.instruments.set(identity, `${capture.snapshot.market.venue} · ${capture.snapshot.market.market} · ${capture.snapshot.market.symbol}`);
      }
    }
    const kindList = this.element.querySelector<HTMLDataListElement>('#journal-v2-kinds');
    const tagList = this.element.querySelector<HTMLDataListElement>('#journal-v2-tags');
    kindList?.replaceChildren(...[...this.kinds].sort().map(value => { const option = html('option') as HTMLOptionElement; option.value = value; return option; }));
    tagList?.replaceChildren(...[...this.tags].sort().map(value => { const option = html('option') as HTMLOptionElement; option.value = value; return option; }));
    const selected = this.instrumentFilter.value;
    this.instrumentFilter.replaceChildren(new Option('All instruments', ''), ...[...this.instruments].sort((a, b) => a[1].localeCompare(b[1])).map(([identity, label]) => new Option(label, identity)));
    if (selected && this.instruments.has(selected)) this.instrumentFilter.value = selected;
    this.optionsLoaded = true;
  }

  private renderEntries(entries: JournalEntry[]) {
    this.imageObserver?.disconnect(); this.revokeUrls(this.feedUrls); this.timeline.replaceChildren();
    if (!entries.length) {
      const empty = html('section', 'journal-v2-empty');
      const heading = html('h2'); heading.textContent = this.scopeSelect.value === 'all' ? 'No matching entries' : 'Nothing in this day yet';
      const copy = html('p'); copy.textContent = this.scopeSelect.value === 'all' ? 'Try another search or clear a filter.' : 'Keep a market observation, review, or idea here.';
      empty.append(heading, copy, action('Add entry', () => this.compose({ entryAt: this.now() })));
      this.timeline.append(empty); return;
    }
    this.imageObserver = new IntersectionObserver(records => {
      for (const record of records) if (record.isIntersecting) { this.imageObserver?.unobserve(record.target); void this.loadFeedImage(record.target as HTMLImageElement); }
    }, { root: this.feed, rootMargin: '180px 0px' });
    for (const entry of entries) this.timeline.append(this.createPost(entry));
    for (const image of this.timeline.querySelectorAll<HTMLImageElement>('img[data-attachment-id]')) this.imageObserver.observe(image);
    const loadMore = action('Load more entries', () => void this.loadMore(loadMore), 'journal-v2-load-more');
    if (entries.length >= 100) this.timeline.append(loadMore);
  }

  private createPost(entry: JournalEntry) {
    const post = html('article', 'journal-v2-post'); post.dataset.entryId = entry.id;
    const time = html('time', 'journal-v2-post-time') as HTMLTimeElement; time.dateTime = new Date(entry.entryAt).toISOString(); time.textContent = timeLabel(entry.entryAt, getDisplayTimezone());
    const marker = html('span', 'journal-v2-post-marker'); marker.setAttribute('aria-hidden', 'true');
    const content = html('div', 'journal-v2-post-content');
    const header = html('header', 'journal-v2-post-header');
    const title = html('h2'); title.textContent = entry.title?.trim() || 'Untitled entry';
    const kind = html('span', 'journal-v2-kind-chip'); kind.textContent = entry.kind;
    header.append(title, kind); content.append(header);
    const body = html('div', 'journal-v2-markdown'); body.append(renderJournalMarkdown(entry.bodyMarkdown, entry.attachments)); content.append(body);
    if (entry.attachments.some(attachment => attachment.kind === 'chart-capture')) {
      const contexts = html('div', 'journal-v2-contexts');
      for (const attachment of entry.attachments.filter(item => item.kind === 'chart-capture')) {
        const chip = action(contextLabel(attachment), () => void this.restoreContext(attachment), 'journal-v2-context-chip'); chip.dataset.attachmentId = attachment.id;
        chip.title = `${contextLabel(attachment)} · market time ${attachment.chartCapture?.marketTime ? formatDateTime(attachment.chartCapture.marketTime, getDisplayTimezone()) : 'unavailable'}`;
        contexts.append(chip);
      }
      content.append(contexts);
    }
    if (entry.tags.length) {
      const tags = html('ul', 'journal-v2-post-tags'); tags.setAttribute('aria-label', 'Tags');
      for (const tag of entry.tags) { const item = html('li'); item.textContent = `#${tag}`; tags.append(item); }
      content.append(tags);
    }
    const actions = html('footer', 'journal-v2-post-actions');
    const edit = action('Edit', () => void this.editEntry(entry.id)); edit.setAttribute('aria-label', `Edit ${entry.title?.trim() || 'untitled entry'}`);
    const remove = action('Delete', () => void this.deleteEntry(entry.id)); remove.setAttribute('aria-label', `Delete ${entry.title?.trim() || 'untitled entry'}`);
    actions.append(edit, remove); content.append(actions); post.append(time, marker, content); return post;
  }

  private async loadFeedImage(image: HTMLImageElement) {
    const attachmentId = image.dataset.attachmentId; if (!attachmentId) return;
    const post = image.closest<HTMLElement>('[data-entry-id]'), entry = this.entries.find(item => item.id === post?.dataset.entryId);
    const attachment = entry?.attachments.find(item => item.id === attachmentId); if (!attachment) return;
    try {
      let cached = this.feedUrls.get(attachment.assetId);
      if (!cached) {
        const asset = await this.repository.asset(attachment.assetId); if (!asset) throw Error('Stored image is missing');
        cached = { url: URL.createObjectURL(asset.blob), assetId: asset.id }; this.feedUrls.set(asset.id, cached);
      }
      if (image.isConnected) image.src = cached.url;
    } catch { if (image.isConnected) { image.alt = `${image.alt || 'Journal image'} · unavailable`; image.classList.add('is-unavailable'); } }
  }

  private renderDrafts(drafts: JournalDraft[]) {
    this.drafts.replaceChildren(); if (!drafts.length) { this.drafts.hidden = true; return; }
    this.drafts.hidden = false;
    const heading = html('h2'); heading.textContent = `Saved drafts · ${drafts.length}`; this.drafts.append(heading);
    for (const draft of drafts) {
      const row = html('article', 'journal-v2-draft-row');
      const summary = html('p'); summary.textContent = `${draft.title?.trim() || 'Untitled draft'} · ${dayLabel(calendarDayAt(draft.entryAt), getDisplayTimezone())}${draft.editingEntryId ? ' · edit' : ''}`;
      row.append(summary, action('Resume', () => void this.resumeDraft(draft.id)), action('Discard', () => void this.discardDraft(draft.id)));
      this.drafts.append(row);
    }
  }

  private async loadComposerAttachmentImage(image: HTMLImageElement) {
    const attachmentId = image.dataset.attachmentId;
    const attachment = this.draft?.attachments.find(item => item.id === attachmentId);
    if (!attachment) return;
    try {
      let cached = this.previewUrls.get(attachment.assetId);
      if (!cached) {
        const local = this.localAssets.get(attachment.assetId);
        const asset = local ?? await this.repository.asset(attachment.assetId);
        if (!asset) throw Error('Stored image is missing');
        cached = { url: URL.createObjectURL(asset.blob), assetId: asset.id }; this.previewUrls.set(asset.id, cached);
      }
      if (image.isConnected) image.src = cached.url;
    } catch { if (image.isConnected) { image.alt = `${image.alt || 'Journal image'} · unavailable`; image.classList.add('is-unavailable'); } }
  }

  private async restoreContext(attachment: JournalAttachment) {
    const capture = attachment.chartCapture;
    if (!capture) { this.status.textContent = 'This attachment has no stored chart context.'; return; }
    if (!this.options.restore) { this.status.textContent = `${contextLabel(attachment)} · saved chart context is available, but restore is not connected.`; return; }
    try { await this.options.restore(capture.snapshot); this.status.textContent = `${contextLabel(attachment)} restored.`; }
    catch (error) { this.status.textContent = `Could not open ${contextLabel(attachment)}: ${asMessage(error)}. The saved context remains available.`; }
  }

  private async editEntry(id: string) {
    try {
      const entry = await this.repository.entry(id); if (!entry) throw Error('Entry is no longer available');
      const draft: JournalDraft = {
        version: 2, id: uid(), entryAt: entry.entryAt, createdAt: this.now(), updatedAt: this.now(), title: entry.title,
        bodyMarkdown: entry.bodyMarkdown, tags: [...entry.tags], kind: entry.kind, attachments: entry.attachments.map(item => ({ ...item })),
        relatedEntryIds: [...entry.relatedEntryIds], editingEntryId: entry.id, expectedUpdatedAt: entry.updatedAt,
      };
      this.openComposer(draft);
    } catch (error) { this.status.textContent = `Could not open entry: ${asMessage(error)}`; }
  }

  private compose(seed: { entryAt: number; relatedEntryIds?: string[]; draftId?: string }) {
    const now = this.now();
    const draft: JournalDraft = {
      version: 2, id: seed.draftId ?? uid(), entryAt: seed.entryAt, createdAt: now, updatedAt: now,
      bodyMarkdown: '', tags: [], kind: [...this.kinds][0] ?? 'note', attachments: [], relatedEntryIds: [...(seed.relatedEntryIds ?? [])],
    };
    if (seed.draftId) void this.resumeDraft(seed.draftId, draft);
    else this.openComposer(draft);
  }

  private async resumeDraft(id: string, fallback?: JournalDraft) {
    try {
      const draft = await this.repository.draft(id);
      if (!draft && !fallback) throw Error('Draft is no longer available');
      this.openComposer(draft ?? fallback!);
    } catch (error) { this.status.textContent = `Could not resume draft: ${asMessage(error)}`; }
  }

  private openComposer(draft: JournalDraft) {
    this.composerGeneration++;
    this.revokeUrls(this.previewUrls); this.localAssets.clear(); this.draft = { ...draft, attachments: draft.attachments.map(item => ({ ...item })) }; this.draftDirty = false; this.previewing = false;
    this.titleInput.value = draft.title ?? ''; this.entryTimeInput.value = dateTimeValue(draft.entryAt, getDisplayTimezone()); this.kindInput.value = draft.kind; this.tagsInput.value = draft.tags.join(', '); this.bodyInput.value = draft.bodyMarkdown;
    this.bodyInput.hidden = false; this.dialog.querySelector<HTMLElement>('.journal-v2-editor-pane')!.hidden = false; this.bodyPreview.hidden = true; this.previewToggle.textContent = 'Preview Markdown'; this.conflictAction.hidden = true;
    this.composerStatus.textContent = 'Draft opened.'; this.dialog.showModal(); this.renderAttachmentControls(); this.titleInput.focus({ preventScroll: true });
    void this.saveDraftNow().catch(error => { this.composerStatus.textContent = `Draft could not be saved: ${asMessage(error)}`; });
  }

  private onComposerInput() {
    if (!this.draft) return;
    this.draftDirty = true; this.composerStatus.dataset.state = 'pending'; this.composerStatus.textContent = 'Saving draft…';
    this.blockAutosaveRetry = false;
    clearTimeout(this.autosaveTimer); this.autosaveTimer = setTimeout(() => { void this.saveDraftNow().catch(() => undefined); }, 650);
    if (this.previewing) this.renderComposerPreview();
  }

  private readDraft(): JournalDraft {
    if (!this.draft) throw Error('No journal draft is open');
    const timezone = getDisplayTimezone();
    const entryAt = parseDateTimeValue(this.entryTimeInput.value, timezone);
    const tags = [...new Set(this.tagsInput.value.split(',').map(value => value.trim().replace(/^#/, '')).filter(Boolean))];
    if (tags.length > JOURNAL_LIMITS.tags) throw Error(`Use no more than ${JOURNAL_LIMITS.tags} tags`);
    const kind = this.kindInput.value.trim(); if (!kind) throw Error('Add a kind for this entry');
    const now = this.now();
    return {
      ...this.draft, entryAt, updatedAt: Math.max(now, this.draft.updatedAt), title: this.titleInput.value.trim() || undefined,
      bodyMarkdown: this.bodyInput.value, kind, tags, attachments: this.draft.attachments.map(item => ({ ...item })),
    };
  }

  private async saveDraftNow(): Promise<void> {
    if (this.savingDraft) return this.savingDraft;
    clearTimeout(this.autosaveTimer);
    let draft: JournalDraft;
    try { draft = this.readDraft(); }
    catch (error) { this.draftDirty = true; this.blockAutosaveRetry = true; this.composerStatus.dataset.state = 'error'; this.composerStatus.textContent = asMessage(error); throw error; }
    this.draft = draft; this.draftDirty = false;
    const assets = [...this.localAssets.values()].filter(asset => draft.attachments.some(item => item.assetId === asset.id || item.thumbnailAssetId === asset.id));
    const generation = this.composerGeneration;
    this.composerStatus.dataset.state = 'pending'; this.composerStatus.textContent = 'Saving draft…';
    this.savingDraft = this.repository.saveDraft(draft, assets).then(() => {
      if (generation === this.composerGeneration && !this.closed) { this.composerStatus.dataset.state = 'saved'; this.composerStatus.textContent = 'Draft saved on this device.'; void this.refresh(); }
    }).catch(async error => {
      if (generation === this.composerGeneration) {
        this.composerStatus.dataset.state = 'error';
        if (this.draft?.editingEntryId && /changed in another tab|being edited changed/i.test(asMessage(error))) {
          if (await this.recoverConflictDraft(error)) return;
        }
        this.draftDirty = true; this.blockAutosaveRetry = true;
        this.composerStatus.textContent = `Draft not saved: ${asMessage(error)}. Keep this editor open and retry.`;
      }
      throw error;
    }).finally(() => { this.savingDraft = undefined; if (!this.closed && this.draftDirty && !this.blockAutosaveRetry) { clearTimeout(this.autosaveTimer); this.autosaveTimer = setTimeout(() => { void this.saveDraftNow().catch(() => undefined); }, 50); } });
    return this.savingDraft;
  }

  private async flushDraft() {
    clearTimeout(this.autosaveTimer);
    while (this.draftDirty || this.savingDraft) {
      if (this.draftDirty && !this.savingDraft) await this.saveDraftNow();
      else if (this.savingDraft) await this.savingDraft;
    }
  }

  private async publishDraft() {
    if (!this.draft) return;
    const publish = this.dialog.querySelector<HTMLButtonElement>('.journal-v2-publish')!; publish.disabled = true;
    try {
      await this.flushDraft();
      const draft = this.readDraft();
      if (!draft.title?.trim() && !draft.bodyMarkdown.trim() && draft.attachments.length === 0) throw Error('Add a title, Markdown text, or an image before publishing');
      const existing = draft.editingEntryId ? await this.repository.entry(draft.editingEntryId) : null;
      if (draft.editingEntryId && !existing) throw Error('The entry was deleted; your draft remains available to recover as a new entry');
      const updatedAt = Math.max(this.now(), draft.updatedAt, existing ? existing.updatedAt + 1 : 0);
      const createdAt = existing?.createdAt ?? updatedAt;
      const revision = {
        at: updatedAt, kind: existing ? 'edit' as const : 'original' as const, entryAt: draft.entryAt, title: draft.title,
        bodyMarkdown: draft.bodyMarkdown, tags: [...draft.tags], entryKind: draft.kind,
        attachments: draft.attachments.map(item => ({ ...item })), relatedEntryIds: [...draft.relatedEntryIds],
      };
      const entry: JournalEntry = {
        version: 2, id: existing?.id ?? draft.id, entryAt: draft.entryAt, createdAt,
        updatedAt, title: draft.title, bodyMarkdown: draft.bodyMarkdown, tags: [...draft.tags], kind: draft.kind,
        attachments: draft.attachments.map(item => ({ ...item })), relatedEntryIds: [...draft.relatedEntryIds],
        revisions: existing ? [...existing.revisions, revision] : [revision],
      };
      const assets = await this.assetsFor(entry.attachments);
      await this.repository.publishDraft(draft.id, entry, assets, draft.expectedUpdatedAt);
      this.options.onPublished?.(entry); this.draft = undefined; this.localAssets.clear(); this.dialog.close(); this.composerStatus.textContent = 'Entry published.';
      this.status.textContent = 'Entry published.'; this.optionsLoaded = false; await this.refresh(true);
    } catch (error) {
      const reason = asMessage(error);
      if (this.draft?.editingEntryId && /changed|conflict|expected|updated/i.test(reason)) {
        this.conflictAction.hidden = false;
        this.composerStatus.textContent = `This entry changed in another editor. Your recoverable draft was kept: ${reason}`;
        try { await this.saveDraftNow(); } catch { /* The previous durable draft remains if this retry also fails. */ }
      } else this.composerStatus.textContent = reason;
    } finally { publish.disabled = false; }
  }

  private async saveConflictAsNew() {
    if (!this.draft) return;
    try {
      const previousId = this.draft.id;
      this.draft = { ...this.readDraft(), id: uid(), editingEntryId: undefined, expectedUpdatedAt: undefined };
      await this.saveDraftNow(); await this.repository.deleteDraft(previousId);
      this.conflictAction.hidden = true; this.composerStatus.textContent = 'Recovered as a new draft. Publish to keep it as a separate entry.';
    } catch (error) { this.composerStatus.textContent = `Could not recover as a new draft: ${asMessage(error)}`; }
  }

  private async recoverConflictDraft(error: unknown): Promise<boolean> {
    if (!this.draft) return false;
    try {
      const previousId = this.draft.id;
      const recovered: JournalDraft = { ...this.readDraft(), id: uid(), editingEntryId: undefined, expectedUpdatedAt: undefined };
      const assets = [...this.localAssets.values()].filter(asset => recovered.attachments.some(item => item.assetId === asset.id || item.thumbnailAssetId === asset.id));
      await this.repository.saveDraft(recovered, assets);
      this.draft = recovered; this.draftDirty = false; this.conflictAction.hidden = true;
      try { await this.repository.deleteDraft(previousId); } catch { /* The copied recovery draft is already durable. */ }
      this.composerStatus.dataset.state = 'error';
      this.composerStatus.textContent = `The source entry changed. A separate recovery draft was saved: ${asMessage(error)}`;
      void this.refresh();
      return true;
    } catch (recoveryError) {
      this.blockAutosaveRetry = true; this.draftDirty = true;
      this.composerStatus.textContent = `Draft conflict: ${asMessage(error)}. Recovery save also failed: ${asMessage(recoveryError)}. Keep this editor open.`;
      return false;
    }
  }

  private async closeComposer(save: boolean) {
    if (!this.dialog.open) return;
    if (save) { try { await this.flushDraft(); } catch { return; } }
    if (this.blockAutosaveRetry) return;
    this.dialog.close(); this.revokeUrls(this.previewUrls);
    if (this.draft) { this.draft = undefined; this.localAssets.clear(); }
  }

  private async discardActiveDraft() {
    const draft = this.draft; if (!draft) return;
    if (!confirm('Discard this saved journal draft and its unreferenced images?')) return;
    try { await this.repository.deleteDraft(draft.id); this.dialog.close(); this.draft = undefined; this.localAssets.clear(); this.revokeUrls(this.previewUrls); this.status.textContent = 'Draft discarded.'; await this.refresh(); }
    catch (error) { this.composerStatus.textContent = `Draft could not be discarded: ${asMessage(error)}`; }
  }

  private async discardDraft(id: string) {
    if (!confirm('Discard this saved journal draft and its unreferenced images?')) return;
    try { await this.repository.deleteDraft(id); this.status.textContent = 'Draft discarded.'; await this.refresh(); }
    catch (error) { this.status.textContent = `Draft could not be discarded: ${asMessage(error)}`; }
  }

  private async deleteEntry(id: string) {
    if (!confirm('Delete this journal entry and its unreferenced images?')) return;
    try { await this.repository.deleteEntry(id); this.status.textContent = 'Entry deleted.'; this.optionsLoaded = false; await this.refresh(true); }
    catch (error) { this.status.textContent = `Entry could not be deleted: ${asMessage(error)}`; }
  }

  private async addImageFiles(files: readonly File[]) {
    if (!this.draft || !files.length) return;
    const available = Math.max(0, JOURNAL_LIMITS.attachments - this.draft.attachments.length);
    if (!available) { this.composerStatus.textContent = `An entry can have at most ${JOURNAL_LIMITS.attachments} attachments.`; return; }
    const images = files.filter(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type));
    const unsupported = files.length - images.length;
    if (unsupported) this.composerStatus.textContent = `${unsupported} file${unsupported === 1 ? '' : 's'} skipped. Use PNG, JPEG, or WebP images.`;
    for (const file of images.slice(0, available)) {
      try {
        if (file.size > JOURNAL_LIMITS.assetBytes) throw Error(`${file.name || 'Image'} exceeds the 20 MB image limit`);
        const attachmentId = uid(), assetId = uid(), asset = await imageAsset(assetId, file);
        const attachment: ImageAttachment = { id: attachmentId, kind: 'image', assetId, alt: 'Image' };
        this.localAssets.set(asset.id, asset); this.draft.attachments.push(attachment);
        const reference = `![${escapeMarkdownAlt(attachment.alt!)}](attachment:${attachment.id})`;
        const start = this.bodyInput.selectionStart, end = this.bodyInput.selectionEnd;
        const separator = start > 0 && this.bodyInput.value[start - 1] !== '\n' ? '\n' : '';
        this.bodyInput.setRangeText(`${separator}${reference}\n`, start, end, 'end'); this.bodyInput.focus();
        this.renderAttachmentControls(); this.onComposerInput();
      } catch (error) { this.composerStatus.textContent = `Could not add image: ${asMessage(error)}`; }
    }
    if (images.length > available) this.composerStatus.textContent = `Only ${available} image${available === 1 ? '' : 's'} fit within the attachment limit.`;
  }

  private renderAttachmentControls() {
    const drop = this.attachmentList.querySelector('.journal-v2-dropzone'); this.attachmentList.replaceChildren(); if (drop) this.attachmentList.append(drop);
    const attachments = this.draft?.attachments ?? [];
    const images = attachments.filter((item): item is ImageAttachment => item.kind === 'image');
    for (const attachment of images) {
      const attachmentId = attachment.id;
      const card = html('article', 'journal-v2-attachment');
      const img = html('img') as HTMLImageElement; img.alt = attachment.alt || 'Journal image preview'; img.dataset.attachmentId = attachment.id;
      const alt = html('input') as HTMLInputElement; alt.type = 'text'; alt.maxLength = 1000; alt.value = attachment.alt ?? '';
      const caption = html('input') as HTMLInputElement; caption.type = 'text'; caption.maxLength = 4000; caption.value = attachment.caption ?? '';
      card.append(img, labeled('Alt text', alt), labeled('Caption', caption), action('Remove image', () => this.removeImage(attachment.id)));
      alt.addEventListener('input', () => {
        const current = this.draft?.attachments.find(item => item.id === attachmentId);
        if (!current || current.kind !== 'image') return;
        current.alt = alt.value; this.replaceAttachmentReference(attachmentId, alt.value); img.alt = alt.value || 'Journal image preview'; this.onComposerInput();
      });
      caption.addEventListener('input', () => {
        const current = this.draft?.attachments.find(item => item.id === attachmentId);
        if (!current || current.kind !== 'image') return;
        current.caption = caption.value; this.onComposerInput();
      });
      this.attachmentList.append(card);
      const local = this.localAssets.get(attachment.assetId);
      if (local) {
        let url = this.previewUrls.get(local.id); if (!url) { url = { url: URL.createObjectURL(local.blob), assetId: local.id }; this.previewUrls.set(local.id, url); }
        img.src = url.url;
      } else void this.loadComposerAttachmentImage(img);
    }
    for (const attachment of attachments.filter(item => item.kind === 'chart-capture')) {
      const row = html('p', 'journal-v2-existing-context'); row.textContent = `Saved chart context · ${contextLabel(attachment)} · market time ${attachment.chartCapture?.marketTime ? formatDateTime(attachment.chartCapture.marketTime, getDisplayTimezone()) : 'unavailable'}`; this.attachmentList.append(row);
    }
  }

  private replaceAttachmentReference(id: string, alt: string) {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`!\\[[^\\]]*\\]\\(attachment:${escapedId}\\)`,'g');
    this.bodyInput.value = this.bodyInput.value.replace(pattern, `![${escapeMarkdownAlt(alt || 'Image')}](attachment:${id})`);
    if (this.previewing) this.renderComposerPreview();
  }

  private removeImage(id: string) {
    if (!this.draft) return;
    const attachment = this.draft.attachments.find(item => item.id === id); if (!attachment) return;
    this.draft.attachments = this.draft.attachments.filter(item => item.id !== id);
    this.bodyInput.value = this.bodyInput.value.replace(new RegExp(`!?\\[[^\\]]*\\]\\(attachment:${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), '');
    this.onComposerInput(); this.renderAttachmentControls();
  }

  private renderComposerPreview() {
    if (!this.draft) return;
    this.bodyPreview.replaceChildren(renderJournalMarkdown(this.bodyInput.value, this.draft.attachments));
    this.previewObserver?.disconnect();
    this.previewObserver = new IntersectionObserver(records => { for (const record of records) if (record.isIntersecting) { this.previewObserver?.unobserve(record.target); void this.loadComposerAttachmentImage(record.target as HTMLImageElement); } }, { root: this.dialog });
    for (const image of this.bodyPreview.querySelectorAll<HTMLImageElement>('img[data-attachment-id]')) this.previewObserver.observe(image);
  }

  private async assetsFor(attachments: readonly JournalAttachment[]) {
    const ids = [...new Set(attachments.flatMap(attachment => [attachment.assetId, attachment.thumbnailAssetId].filter((id): id is string => Boolean(id))))];
    const assets: JournalAsset[] = [];
    for (const id of ids) {
      const local = this.localAssets.get(id); const asset = local ?? await this.repository.asset(id);
      if (!asset) throw Error('An attachment image is missing from local storage; remove it and add the image again');
      assets.push(asset);
    }
    return assets;
  }

  private async exportCurrent() {
    const query = this.query(); let cursor: JournalQuery['before']; const records: JournalEntry[] = [];
    for (;;) {
      const batch = await this.repository.entries({ ...query, ...(cursor ? { before: cursor } : {}), limit: 500 });
      records.push(...batch); if (records.length > JOURNAL_LIMITS.entriesPerImport) throw Error('Export up to 1,000 entries; narrow the current filters.');
      if (batch.length < 500) break;
      const last = batch.at(-1)!; cursor = { entryAt: last.entryAt, id: last.id };
    }
    const drafts = await this.repository.drafts();
    if (!records.length && !drafts.length) throw Error('There are no matching entries or saved drafts to export');
    if (records.length + drafts.length > JOURNAL_LIMITS.entriesPerImport) throw Error('Backup up to 1,000 entries and drafts at a time; narrow the current filters.');
    downloadBlob(await exportJournal(this.repository, records, drafts), 'iqterminal-global-journal.json');
    this.status.textContent = `Exported ${records.length} matching entries and ${drafts.length} saved drafts with their stored images.`;
  }

  private async loadMore(button: HTMLButtonElement) {
    button.disabled = true;
    try {
      const generation = this.pageGeneration, last = this.entries.at(-1); if (!last) return;
      const more = await this.repository.entries({ ...this.query(), before: { entryAt: last.entryAt, id: last.id }, limit: 100 });
      if (generation !== this.pageGeneration) return;
      this.entries.push(...more); button.remove();
      for (const entry of more) this.timeline.append(this.createPost(entry));
      for (const image of this.timeline.querySelectorAll<HTMLImageElement>('img[data-attachment-id]:not([src])')) this.imageObserver?.observe(image);
      if (more.length === 100) this.timeline.append(button);
      this.feedStatus.textContent = this.resultIsCapped(more) ? 'The journal search reached its scan limit. Narrow filters to continue.' : `${this.entries.length} entries loaded.`;
    } catch (error) { this.status.textContent = `Could not load more entries: ${asMessage(error)}`; }
    finally { button.disabled = false; }
  }

  private resultIsCapped(entries: JournalEntry[]) { return Boolean((entries as JournalEntry[] & { capped?: boolean }).capped); }
  private scheduleRefresh() { clearTimeout(this.refreshTimer); this.refreshTimer = setTimeout(() => void this.refresh(), 180); }
  private selectDay(day: string) { this.selectedDay = day; this.dateInput.value = day; this.updateDateLabel(); void this.refresh(); }
  private updateDateLabel() { this.headingDate.textContent = `${dayLabel(this.selectedDay, getDisplayTimezone())}${this.selectedDay === this.todayDay ? ' · Today' : ''}`; }
  private updateClearButton() {
    this.filterClear.hidden = !(this.scopeSelect.value !== 'day' || this.searchInput.value || this.kindFilter.value || this.tagFilter.value || this.instrumentFilter.value);
  }

  private async revealEntry(id: string, entryAt?: number, attachmentId?: string) {
    try {
      const target = await this.repository.entry(id); if (!target) throw Error('Entry is no longer available');
      const day = calendarDayAt(entryAt ?? target.entryAt, getDisplayTimezone());
      this.selectedDay = day; this.dateInput.value = day;
      this.scopeSelect.value = 'day'; this.searchInput.value = ''; this.kindFilter.value = ''; this.tagFilter.value = ''; this.instrumentFilter.value = '';
      this.updateClearButton(); this.updateDateLabel(); await this.refresh();
      if (!this.entries.some(entry => entry.id === id)) {
        this.entries.push(target);
        this.entries.sort((a, b) => this.sort === 'newest' ? b.entryAt - a.entryAt || b.id.localeCompare(a.id) : a.entryAt - b.entryAt || a.id.localeCompare(b.id));
        this.renderEntries(this.entries);
      }
      const post = this.timeline.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`);
      if (!post) throw Error('Entry was loaded but could not be located in the daily feed');
      post.scrollIntoView({ block: 'center' });
      const targetNode = attachmentId ? post.querySelector<HTMLElement>(`[data-attachment-id="${CSS.escape(attachmentId)}"]`) : post;
      const focusTarget = targetNode ?? post; focusTarget.tabIndex = -1; focusTarget.focus({ preventScroll: true });
      this.status.textContent = attachmentId && !targetNode ? 'The entry is open, but that attachment is no longer available.' : '';
    } catch (error) { this.status.textContent = `Could not open journal entry: ${asMessage(error)}`; }
  }

  private clearFilters() { this.scopeSelect.value = 'day'; this.searchInput.value = ''; this.kindFilter.value = ''; this.tagFilter.value = ''; this.instrumentFilter.value = ''; this.updateClearButton(); void this.refresh(); }
  private onTimezoneChanged() {
    const oldToday = this.todayDay; this.todayDay = calendarDayAt(this.now());
    if (this.selectedDay === oldToday) { this.selectedDay = this.todayDay; this.dateInput.value = this.selectedDay; }
    const timezone = this.element.querySelector<HTMLElement>('.journal-v2-timezone'); if (timezone) timezone.textContent = getDisplayTimezone();
    this.updateDateLabel(); this.scheduleMidnight(); void this.refresh();
  }
  private onVisibilityChanged() {
    if (document.hidden) { if (this.draftDirty) void this.flushDraft().catch(() => undefined); return; }
    this.onTimezoneChanged();
  }
  private scheduleMidnight() {
    clearTimeout(this.midnightTimer); const timezone = getDisplayTimezone();
    try { const next = journalDayRange(shiftCalendarDay(calendarDayAt(this.now(), timezone), 1), timezone).from; this.midnightTimer = setTimeout(() => { const previous = this.todayDay; this.todayDay = calendarDayAt(this.now(), timezone); if (this.selectedDay === previous) { this.selectedDay = this.todayDay; this.dateInput.value = this.selectedDay; } this.updateDateLabel(); this.scheduleMidnight(); void this.refresh(); }, Math.max(25, next - this.now() + 30)); }
    catch { this.midnightTimer = setTimeout(() => { this.todayDay = calendarDayAt(this.now()); this.scheduleMidnight(); void this.refresh(); }, 60_000); }
  }
  private revokeUrls(collection: Map<string, AssetUrl>) { for (const item of collection.values()) URL.revokeObjectURL(item.url); collection.clear(); }
  private async task(work: () => Promise<void>) { try { await work(); } catch (error) { this.status.textContent = asMessage(error); } }
}

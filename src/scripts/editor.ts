import type { IDockviewPanelProps, IContentRenderer } from 'dockview-core';
import type { CandlePanel } from '../panel';
import type { ScriptStudyHost, ScriptInputView, StudyView } from './host';
import { ScriptLibrary, type ScriptRecord } from './library';
import type { ScriptResult } from './runtime';
import { requiredScriptCapabilities } from './capabilities';
import { makeInputControl, readInputSettings } from './input-controls';
import { instrumentLabel } from '../feed/protocol';

export interface EditorTarget {
  id: string;
  panel: CandlePanel;
}

/** Vanilla DOM editor for local OpenScript revisions and chart attachments. */
export class ScriptEditorPanel implements IContentRenderer {
  readonly element = document.createElement('section');
  private params!: IDockviewPanelProps;
  private abort = new AbortController();
  private unsubscribe?: () => void;
  private paramsSubscription?: { dispose(): void };
  private target = document.createElement('select');
  private script = document.createElement('select');
  private attachment = document.createElement('select');
  private title = document.createElement('input');
  private description = document.createElement('textarea');
  private author = document.createElement('input');
  private license = document.createElement('input');
  private source = document.createElement('textarea');
  private inputs = document.createElement('div');
  private attachments = document.createElement('div');
  private status = document.createElement('div');
  private file = document.createElement('input');
  private records: ScriptRecord[] = [];
  private previewInputs: ScriptInputView[] = [];
  private currentScriptId = '';
  private activeAttachmentId = '';
  private attachmentSelectionGeneration = 0;
  private dirty = false;
  private busy = false;
  private dead = false;

  constructor(
    private readonly library: ScriptLibrary,
    private readonly targets: () => EditorTarget[],
    private readonly save: () => void,
  ) {
    this.element.className = 'script-editor-panel';
  }

  refreshTargets() {
    if (this.dead || !this.params) return;
    this.renderTargets();
    if (!this.target.value && this.target.options.length) this.target.selectedIndex = 0;
    this.bindTarget();
  }

  init(params: IDockviewPanelProps) {
    this.params = params;
    params.api.setTitle('OpenScript');
    this.element.dataset.panelId = params.api.id;
    this.paramsSubscription = params.api.onDidParametersChange(next => {
      const id = typeof next.targetChartId === 'string' ? next.targetChartId : '';
      const attachmentId = typeof next.attachmentId === 'string' ? next.attachmentId : '';
      void this.selectRequestedAttachment(id, attachmentId);
    });
    this.build();
    const options = { signal: this.abort.signal };
    this.target.addEventListener('change', () => this.targetChanged(), options);
    this.script.addEventListener('change', () => void this.selectScript(), options);
    this.attachment.addEventListener('change', () => void this.selectAttachment(), options);
    this.source.addEventListener('input', () => { this.dirty = true; this.previewInputs = []; this.renderInputs(); }, options);
    this.title.addEventListener('input', () => { this.dirty = true; }, options);
    this.description.addEventListener('input', () => { this.dirty = true; }, options);
    this.author.addEventListener('input', () => { this.dirty = true; }, options);
    this.license.addEventListener('input', () => { this.dirty = true; }, options);
    this.inputs.addEventListener('input', () => { this.dirty = true; }, options);
    this.file.addEventListener('change', () => void this.importFile(), options);
    this.element.addEventListener('click', event => void this.action(event), options);
    this.attachments.addEventListener('change', event => {
      const control = event.target;
      if (!(control instanceof HTMLInputElement) || control.type !== 'checkbox' || !control.dataset.attachmentId) return;
      this.host()?.setVisibleStudy(control.dataset.attachmentId, control.checked);
    }, options);
    void this.load();
  }

  private build() {
    const header = document.createElement('header');
    const heading = document.createElement('h2');
    heading.textContent = 'OpenScript studies';
    const intro = document.createElement('p');
    intro.textContent = 'Edit local, versioned studies and attach them to a chart. Scripts run in a bounded worker.';
    header.append(heading, intro);

    const toolbar = document.createElement('div');
    toolbar.className = 'script-editor-toolbar';
    this.target.setAttribute('aria-label', 'Target chart');
    this.script.setAttribute('aria-label', 'Local script library');
    this.attachment.setAttribute('aria-label', 'Attached study');
    this.file.type = 'file';
    this.file.accept = '.oscript,.json,application/json,text/plain';
    this.file.hidden = true;
    toolbar.append(this.field('Chart', this.target), this.field('Library', this.script), this.field('Attached study', this.attachment));

    const metadata = document.createElement('div');
    metadata.className = 'script-metadata';
    this.title.maxLength = 80;
    this.description.maxLength = 500;
    this.author.maxLength = 80;
    this.license.maxLength = 80;
    this.description.rows = 2;
    metadata.append(this.field('Title', this.title), this.field('Description', this.description), this.field('Author', this.author), this.field('License', this.license));

    const body = document.createElement('div');
    body.className = 'script-editor-body';
    this.source.className = 'script-source';
    this.source.spellcheck = false;
    this.source.setAttribute('aria-label', 'OpenScript source');
    this.source.rows = 18;
    const controls = document.createElement('aside');
    controls.className = 'script-controls';
    const inputHeading = document.createElement('h3');
    inputHeading.textContent = 'Inputs';
    this.inputs.className = 'script-inputs';
    const attachmentHeading = document.createElement('h3');
    attachmentHeading.textContent = 'Chart studies';
    this.attachments.className = 'script-attachments';
    controls.append(inputHeading, this.inputs, attachmentHeading, this.attachments);
    body.append(this.source, controls);

    const actions = document.createElement('div');
    actions.className = 'script-editor-actions';
    actions.append(
      this.button('Preview inputs', 'preview'),
      this.button('Apply', 'apply', true),
      this.button('Save', 'save'),
      this.button('Save copy', 'copy'),
      this.button('Export package', 'export-package'),
      this.button('Export source', 'export-source'),
      this.button('Import', 'import'),
    );
    actions.append(this.file);
    this.status.className = 'script-editor-status';
    this.status.setAttribute('role', 'status');
    this.element.append(header, toolbar, metadata, body, actions, this.status);
  }

  private field(label: string, control: HTMLElement) {
    const wrapper = document.createElement('label');
    wrapper.className = 'script-field';
    const name = document.createElement('span');
    name.textContent = label;
    wrapper.append(name, control);
    return wrapper;
  }

  private button(label: string, action: string, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.action = action;
    if (primary) button.className = 'primary';
    return button;
  }

  private async load() {
    try {
      await this.library.ensureBuiltIns();
      this.records = await this.library.list();
      if (this.dead) return;
      this.renderTargets();
      this.renderLibrary();
      if (!this.script.value) this.script.value = this.records.find(record => record.id === 'builtin.ema-overlay')?.id ?? this.records[0]?.id ?? '';
      this.bindTarget();
      await this.selectScript();
      const requestedAttachment = typeof this.params.params?.attachmentId === 'string' ? this.params.params.attachmentId : '';
      if (requestedAttachment && [...this.attachment.options].some(option => option.value === requestedAttachment)) {
        this.attachment.value = requestedAttachment;
        await this.selectAttachment();
      }
      this.setStatus(this.library.damagedRecordCount
        ? `Local library ready. ${this.library.damagedRecordCount} damaged record${this.library.damagedRecordCount === 1 ? '' : 's'} hidden; built-in examples remain available.`
        : 'Local library ready. Saved revisions remain on this device.');
    } catch (error) { this.setStatus(errorText(error)); }
  }

  private renderTargets() {
    const selected = this.target.value || String(this.params.params?.targetChartId ?? '');
    this.target.replaceChildren();
    for (const { id, panel } of this.targets()) {
      const option = new Option(`${instrumentLabel(panel.series)} · ${panel.series.interval}`, id);
      this.target.add(option);
    }
    if (selected && [...this.target.options].some(option => option.value === selected)) this.target.value = selected;
    if (!this.target.value && this.target.options.length) this.target.selectedIndex = 0;
    this.target.disabled = !this.target.options.length;
    this.renderAttachments();
  }

  private renderLibrary() {
    const selected = this.currentScriptId || this.script.value;
    this.script.replaceChildren(new Option('Choose a script…', ''));
    for (const record of this.records) this.script.add(new Option(`${record.builtin ? 'Example' : 'Local'} · ${record.title}`, record.id));
    if (selected && this.records.some(record => record.id === selected)) this.script.value = selected;
    const save = this.element.querySelector<HTMLButtonElement>('[data-action="save"]');
    const current = this.records.find(record => record.id === this.currentScriptId);
    if (save) {
      save.disabled = !current || current.builtin;
      save.title = current?.builtin ? 'Examples are read-only; use Save copy to edit them.' : 'Save this source as a new immutable local revision.';
    }
  }

  private bindTarget() {
    this.unsubscribe?.();
    const host = this.host();
    if (host) this.unsubscribe = host.subscribe(() => this.renderAttachments());
    this.renderAttachments();
  }

  private host(): ScriptStudyHost | undefined {
    const target = this.targets().find(item => item.id === this.target.value);
    return target?.panel.studies;
  }

  private targetChanged() {
    const targetChartId = this.target.value;
    this.attachmentSelectionGeneration++;
    this.params.api.updateParameters({ targetChartId });
    this.bindTarget();
  }

  private async selectRequestedAttachment(targetChartId: string, attachmentId: string) {
    // A new Dockview request invalidates any older revision load before we
    // decide whether the requested chart/attachment may replace a dirty draft.
    this.attachmentSelectionGeneration++;
    const previousTargetId = this.target.value;
    const previousAttachmentId = this.activeAttachmentId || this.attachment.value;
    const requestedTargetId = targetChartId && [...this.target.options].some(option => option.value === targetChartId)
      ? targetChartId : previousTargetId;
    const targetChanged = requestedTargetId !== previousTargetId;
    const attachmentChanged = attachmentId !== previousAttachmentId;

    if ((targetChanged || attachmentChanged) && this.dirty
      && !window.confirm('Discard the current unsaved editor draft?')) {
      // Dockview has already published the requested parameters. Revert them as
      // well as leaving the controls/host untouched so the next action cannot
      // target a chart different from the draft the user kept.
      this.params.api.updateParameters({ targetChartId: previousTargetId, attachmentId: previousAttachmentId });
      return;
    }

    if (targetChanged || attachmentChanged) this.dirty = false;
    this.renderTargets();
    this.target.value = requestedTargetId;
    this.bindTarget();
    const targetHasAttachment = attachmentId !== ''
      && [...this.attachment.options].some(option => option.value === attachmentId);
    this.attachment.value = targetHasAttachment ? attachmentId : '';
    if (!targetHasAttachment && (targetChanged || attachmentChanged)) {
      this.activeAttachmentId = '';
      await this.selectScript();
      if (attachmentId) this.params.api.updateParameters({ targetChartId: requestedTargetId, attachmentId: '' });
      return;
    }
    if (targetHasAttachment) await this.selectAttachment();
  }

  private async selectScript() {
    const record = this.records.find(item => item.id === this.script.value);
    if (!record) return;
    if (this.dirty && record.id !== this.currentScriptId && !window.confirm('Discard the current unsaved editor draft?')) {
      this.script.value = this.currentScriptId;
      return;
    }
    this.currentScriptId = record.id;
    this.renderLibrary();
    const revision = record.revisions.find(item => item.id === record.currentRevision) ?? record.revisions.at(-1);
    if (!revision) return;
    this.title.value = record.title;
    this.description.value = record.description;
    this.author.value = record.author ?? '';
    this.license.value = record.license ?? '';
    this.source.value = revision.source;
    this.dirty = false;
    this.previewInputs = [];
    this.renderInputs();
    await this.renderAttachments();
  }

  private async selectAttachment() {
    const generation = ++this.attachmentSelectionGeneration;
    const selectedId = this.attachment.value;
    if (!selectedId) { this.activeAttachmentId = ''; this.renderInputs(); return; }
    if (selectedId === this.activeAttachmentId) return;
    if (this.dirty && selectedId !== this.activeAttachmentId && !window.confirm('Discard the current unsaved editor draft?')) {
      this.attachment.value = this.activeAttachmentId;
      return;
    }
    const view = this.host()?.views().find(study => study.attachmentId === selectedId);
    if (!view) return;
    const revision = await this.library.getRevision(view.scriptId, view.revisionId);
    if (generation !== this.attachmentSelectionGeneration || !revision || this.dead) {
      if (!revision && generation === this.attachmentSelectionGeneration && !this.dead) this.setStatus('The pinned revision is missing. Reimport it or remove this attachment.');
      return;
    }
    this.activeAttachmentId = selectedId;
    this.script.value = view.scriptId;
    const record = this.records.find(item => item.id === view.scriptId);
    if (record) {
      this.currentScriptId = record.id;
      this.renderLibrary();
      this.title.value = view.title;
      this.description.value = view.description;
      this.author.value = record.author ?? '';
      this.license.value = record.license ?? '';
    }
    this.source.value = revision.source;
    this.previewInputs = view.inputs;
    this.dirty = false;
    this.renderInputs(view.settings);
  }

  private async renderAttachments() {
    const views = this.host()?.views() ?? [];
    const selected = this.attachment.value;
    this.attachment.replaceChildren(new Option('New attachment', ''));
    for (const study of views) this.attachment.add(new Option(`${study.title} · ${study.status}`, study.attachmentId));
    if (views.some(study => study.attachmentId === selected)) this.attachment.value = selected;
    this.attachments.replaceChildren();
    if (!views.length) {
      const empty = document.createElement('p'); empty.textContent = 'No studies attached to this chart.'; this.attachments.append(empty); return;
    }
    for (const view of views) {
      const row = document.createElement('div'); row.className = 'script-attachment';
      const label = document.createElement('span'); label.textContent = `${view.title} · ${view.status}`;
      label.title = view.status;
      const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = view.visible; visible.setAttribute('aria-label', `Show ${view.title}`);
      visible.dataset.attachmentId = view.attachmentId;
      const remove = this.button('Remove', 'remove'); remove.dataset.attachmentId = view.attachmentId;
      const edit = this.button('Edit', 'edit'); edit.dataset.attachmentId = view.attachmentId;
      row.append(visible, label, edit, remove); this.attachments.append(row);
    }
  }

  private async preview() {
    const result = await this.inspect(this.source.value);
    this.previewInputs = result.program?.inputs.map(input => ({
      key: input.key, label: input.label, kind: input.kind, defaultValue: primitive(input.default),
      min: input.min, max: input.max, step: input.step, options: (input.options ?? []).map(primitive).filter((v): v is string | number | boolean => v !== null), tooltip: input.tooltip ?? '',
    })) ?? [];
    this.renderInputs();
    this.setStatus(`Compiled ${this.previewInputs.length} input${this.previewInputs.length === 1 ? '' : 's'} for this draft.`);
  }

  private renderInputs(settings: Record<string, string | number | boolean> = {}) {
    this.inputs.replaceChildren();
    const attached = this.attachment.value ? this.host()?.views().find(view => view.attachmentId === this.attachment.value) : undefined;
    const inputs = attached?.inputs.length ? attached.inputs : this.previewInputs;
    if (!inputs.length) {
      const hint = document.createElement('p'); hint.textContent = 'Preview inputs to build controls from this script.'; this.inputs.append(hint); return;
    }
    const values = Object.keys(settings).length ? settings : attached?.settings ?? {};
    for (const item of inputs) {
      const control = makeInputControl(item, values[item.key]);
      control.dataset.inputKey = item.key;
      control.title = item.tooltip;
      this.inputs.append(this.field(item.label, control));
    }
  }

  private settings() {
    return readInputSettings(this.inputs);
  }

  private async action(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'import') { this.file.click(); return; }
    if (action === 'edit' && button.dataset.attachmentId) { this.attachment.value = button.dataset.attachmentId; await this.selectAttachment(); return; }
    if (action === 'remove' && button.dataset.attachmentId) { this.host()?.remove(button.dataset.attachmentId); this.attachment.value = ''; await this.renderAttachments(); return; }
    if (action === 'apply') await this.run('apply', () => this.applyDraft());
    else if (action === 'preview') await this.run('preview', () => this.preview());
    else if (action === 'save') await this.run('save', () => this.saveRevision());
    else if (action === 'copy') await this.run('copy', () => this.saveCopy());
    else if (action === 'export-package') await this.run('export', () => this.exportFile(true));
    else if (action === 'export-source') await this.run('export', () => this.exportFile(false));
  }

  private async run(label: string, operation: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.element.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
    try { await operation(); }
    catch (error) { this.setStatus(errorText(error)); }
    finally {
      this.busy = false;
      this.element.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; });
      if (this.dead) return;
    }
  }

  private async applyDraft() {
    const host = this.host();
    if (!host) throw new Error('Choose a chart that is still open.');
    const record = this.records.find(item => item.id === this.currentScriptId);
    if (!record) throw new Error('Save this draft to the local library before applying it.');
    const attachmentId = this.attachment.value || undefined;
    const id = await host.apply({
      attachmentId, scriptId: record.id, source: this.source.value,
      title: this.title.value, description: this.description.value, settings: this.settings(),
    });
    this.attachment.value = id;
    this.activeAttachmentId = id;
    const currentRevision = record.revisions.find(revision => revision.id === record.currentRevision);
    this.dirty = !currentRevision || currentRevision.source !== this.source.value
      || record.title !== this.title.value || record.description !== this.description.value
      || (record.author ?? '') !== this.author.value || (record.license ?? '') !== this.license.value;
    await this.renderAttachments();
    this.setStatus('Applied. This chart now pins the exact immutable revision.');
  }

  private async saveRevision() {
    const id = this.currentScriptId;
    if (!id) throw new Error('Choose or save a script first.');
    const capabilities = await this.inspect(this.source.value).then(result => requiredScriptCapabilities(result.program!));
    const saved = await this.library.saveRevision(id, this.metadata(), this.source.value, capabilities);
    this.records = await this.library.list();
    this.currentScriptId = saved.id;
    this.renderLibrary();
    this.dirty = false;
    this.setStatus(`Saved revision ${saved.currentRevision.slice(0, 12)}…`);
  }

  private async saveCopy() {
    const capabilities = await this.inspect(this.source.value).then(result => requiredScriptCapabilities(result.program!));
    const saved = await this.library.saveCopy(this.metadata(), this.source.value, capabilities);
    this.records = await this.library.list();
    this.currentScriptId = saved.id;
    this.renderLibrary();
    this.script.value = saved.id;
    this.dirty = false;
    this.setStatus(`Saved ${saved.title} as a new local script.`);
  }

  private metadata() {
    return { title: this.title.value, description: this.description.value, ...(this.author.value ? { author: this.author.value } : {}), ...(this.license.value ? { license: this.license.value } : {}) };
  }

  private async exportFile(packaged: boolean) {
    const record = this.records.find(item => item.id === this.currentScriptId);
    if (!record) throw new Error('Choose a saved script to export.');
    const revision = record.revisions.find(item => item.id === record.currentRevision);
    if (!revision) throw new Error('The selected saved revision is missing. Save the draft first.');
    const content = packaged
      ? await this.library.exportPackage(record.id, revision.id, requiredScriptCapabilities((await this.inspect(revision.source)).program!))
      : await this.library.exportSource(record.id, revision.id);
    download(content, `${safeFilename(record.title)}${packaged ? '.json' : '.oscript'}`, packaged ? 'application/json' : 'text/plain');
    this.setStatus(`Exported ${record.title}.`);
  }

  private async importFile() {
    const file = this.file.files?.[0];
    if (!file) return;
    try {
      const imported = await this.library.importText(await file.text(), file.name, async source => requiredScriptCapabilities((await this.inspect(source)).program!));
      this.records = await this.library.list();
      this.currentScriptId = imported.id;
      this.renderLibrary();
      this.script.value = imported.id;
      await this.selectScript();
      this.setStatus(`Imported ${imported.title} as a new local script.`);
    } catch (error) { this.setStatus(errorText(error)); }
    finally { this.file.value = ''; }
  }

  private setStatus(value: string) { this.status.textContent = value; }

  private async inspect(source: string): Promise<ScriptResult> {
    const host = this.host();
    if (!host) throw new Error('Open a chart before compiling this script.');
    const result = await host.preview(source, this.settings());
    if (!result.ok || !result.program) throw new Error(result.diagnostics[0]?.message ?? 'The script did not compile in its worker.');
    return result;
  }

  dispose() {
    this.dead = true;
    this.abort.abort();
    this.unsubscribe?.();
    this.paramsSubscription?.dispose();
  }
}

function primitive(value: unknown): string | number | boolean | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [kind, raw] = value;
  if (kind === 'n' && typeof raw === 'number' && Number.isFinite(raw) || kind === 's' && typeof raw === 'string' || kind === 'b' && typeof raw === 'boolean') return raw as string | number | boolean;
  if (kind === 'c' && Array.isArray(raw) && raw.length >= 3) return `#${raw.slice(0, 3).map((channel: number) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
  return null;
}

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function safeFilename(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'study'; }
function errorText(error: unknown) { return error instanceof Error ? error.message : 'The editor action failed.'; }

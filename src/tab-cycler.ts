import type { DockviewGroupPanel } from 'dockview-core';

export interface CyclePanel {
  readonly id: string;
  api: { setActive(): void };
}

export interface CycleGroup {
  readonly panels: readonly CyclePanel[];
  readonly activePanel: CyclePanel | undefined;
}

export type CyclePauseReason = 'dialog' | 'hidden';
export const DEFAULT_TAB_DWELL_SECONDS = 10;
export const MIN_TAB_DWELL_SECONDS = 1;
export const MAX_TAB_DWELL_SECONDS = 3600;

/** Timer state for one Dockview group. It reads the group's live tab order at each tick. */
export class GroupTabCycler {
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private readonly pauseReasons = new Set<CyclePauseReason>();
  private seconds = DEFAULT_TAB_DWELL_SECONDS;
  private active = false;
  private disposed = false;
  private switching = false;

  constructor(private readonly group: CycleGroup, private readonly onStateChange: () => void = () => {}) {}

  get running() { return this.active; }
  get secondsPerTab() { return this.seconds; }

  start(secondsPerTab: number) {
    if (this.disposed || !Number.isInteger(secondsPerTab) || secondsPerTab < MIN_TAB_DWELL_SECONDS || secondsPerTab > MAX_TAB_DWELL_SECONDS || this.group.panels.length <= 1) return false;
    this.seconds = secondsPerTab;
    const wasRunning = this.active;
    this.active = true;
    this.schedule();
    if (!wasRunning) this.onStateChange();
    return true;
  }

  stop() {
    if (!this.active && !this.timeout) return;
    this.active = false;
    this.clearTimeout();
    this.onStateChange();
  }

  resetDwell() {
    this.schedule();
  }

  activePanelChanged() {
    if (!this.switching) this.resetDwell();
  }

  groupChanged() {
    if (this.group.panels.length <= 1) this.stop();
    else this.resetDwell();
  }

  pause(reason: CyclePauseReason) {
    this.pauseReasons.add(reason);
    this.clearTimeout();
  }

  resume(reason: CyclePauseReason) {
    this.pauseReasons.delete(reason);
    this.schedule();
  }

  dispose() {
    if (this.disposed) return;
    this.active = false;
    this.disposed = true;
    this.pauseReasons.clear();
    this.clearTimeout();
  }

  private clearTimeout() {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  private schedule() {
    this.clearTimeout();
    if (!this.active || this.disposed || this.pauseReasons.size) return;
    if (this.group.panels.length <= 1) {
      this.stop();
      return;
    }
    this.timeout = setTimeout(() => {
      this.timeout = undefined;
      this.advance();
    }, this.seconds * 1000);
  }

  private advance() {
    if (!this.active || this.disposed || this.pauseReasons.size) return;
    const panels = this.group.panels;
    if (panels.length <= 1) {
      this.stop();
      return;
    }
    const currentIndex = this.group.activePanel ? panels.findIndex(panel => panel.id === this.group.activePanel?.id) : -1;
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % panels.length;
    this.switching = true;
    try {
      panels[nextIndex]?.api.setActive();
    } finally {
      this.switching = false;
    }
    this.schedule();
  }
}

/** Dockview's prefix slot is the leading position before its native tab strip. */
export class TabCycleHeaderAction {
  readonly element = document.createElement('div');
  private readonly group: DockviewGroupPanel;
  private readonly button = document.createElement('button');
  private readonly dialog = document.createElement('dialog');
  private readonly seconds = document.createElement('input');
  private readonly error = document.createElement('p');
  private readonly startButton = document.createElement('button');
  private readonly restartButton = document.createElement('button');
  private readonly stopButton = document.createElement('button');
  private readonly cycler: GroupTabCycler;
  private readonly subscriptions: { dispose(): void }[] = [];
  private readonly abort = new AbortController();
  private disposed = false;

  constructor(group: DockviewGroupPanel) {
    this.group = group;
    this.element.className = 'tab-cycle-actions';
    this.element.dataset.groupId = group.id;
    this.button.type = 'button';
    this.button.className = 'tab-cycle-toggle';
    this.button.setAttribute('aria-label', 'Cycle tabs');
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-pressed', 'false');
    this.button.title = 'Cycle group tabs';
    this.button.append(makeCycleIcon());
    this.element.append(this.button);

    this.dialog.className = 'tab-cycle-dialog';
    this.dialog.setAttribute('aria-labelledby', `tab-cycle-title-${safeId(group.id)}`);
    const form = document.createElement('form');
    form.className = 'tab-cycle-form';
    form.addEventListener('submit', event => this.submit(event), { signal: this.abort.signal });

    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.id = `tab-cycle-title-${safeId(group.id)}`;
    title.textContent = 'Cycle group tabs';
    header.append(title);

    const fields = document.createElement('div');
    fields.className = 'tab-cycle-fields';
    const label = document.createElement('label');
    label.className = 'tab-cycle-field';
    label.htmlFor = `tab-cycle-seconds-${safeId(group.id)}`;
    label.textContent = 'Seconds per tab';
    this.seconds.type = 'number';
    this.seconds.id = label.htmlFor;
    this.seconds.name = 'secondsPerTab';
    this.seconds.min = String(MIN_TAB_DWELL_SECONDS);
    this.seconds.max = String(MAX_TAB_DWELL_SECONDS);
    this.seconds.step = '1';
    this.seconds.required = true;
    this.seconds.value = String(DEFAULT_TAB_DWELL_SECONDS);
    this.seconds.setAttribute('aria-describedby', `tab-cycle-help-${safeId(group.id)} tab-cycle-error-${safeId(group.id)}`);
    this.seconds.addEventListener('input', () => this.clearError(), { signal: this.abort.signal });
    label.append(this.seconds);
    const help = document.createElement('small');
    help.id = `tab-cycle-help-${safeId(group.id)}`;
    help.textContent = 'The current tab stays active for the full interval before the first switch.';
    this.error.className = 'tab-cycle-error';
    this.error.id = `tab-cycle-error-${safeId(group.id)}`;
    this.error.setAttribute('role', 'alert');
    this.error.hidden = true;
    fields.append(label, help, this.error);

    const footer = document.createElement('footer');
    const cancelButton = actionButton('Cancel', 'tab-cycle-cancel');
    cancelButton.addEventListener('click', () => this.dialog.close(), { signal: this.abort.signal });
    this.startButton.type = 'submit';
    this.startButton.className = 'primary';
    this.startButton.dataset.action = 'start';
    this.startButton.textContent = 'Start';
    this.restartButton.type = 'submit';
    this.restartButton.className = 'primary';
    this.restartButton.dataset.action = 'restart';
    this.restartButton.textContent = 'Restart';
    this.stopButton.type = 'button';
    this.stopButton.dataset.action = 'stop';
    this.stopButton.textContent = 'Stop';
    this.stopButton.addEventListener('click', () => {
      this.cycler.stop();
      this.dialog.close();
    }, { signal: this.abort.signal });
    footer.append(cancelButton, this.stopButton, this.restartButton, this.startButton);
    form.append(header, fields, footer);
    this.dialog.append(form);
    this.element.append(this.dialog);

    this.cycler = new GroupTabCycler(group, () => this.updateToggle());
    this.button.addEventListener('pointerdown', event => event.stopPropagation(), { signal: this.abort.signal });
    this.button.addEventListener('click', event => {
      event.stopPropagation();
      this.openDialog();
    }, { signal: this.abort.signal });
    this.dialog.addEventListener('close', () => this.dialogClosed(), { signal: this.abort.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cycler.pause('hidden');
      else this.cycler.resume('hidden');
    }, { signal: this.abort.signal });
    this.subscriptions.push(
      group.api.onDidActivePanelChange(() => this.cycler.activePanelChanged()),
      group.model.onDidAddPanel(() => this.syncPanelCount()),
      group.model.onDidRemovePanel(() => this.syncPanelCount()),
    );
    if (document.hidden) this.cycler.pause('hidden');
    this.syncPanelCount();
  }

  init() {}

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cycler.dispose();
    this.subscriptions.forEach(subscription => subscription.dispose());
    this.abort.abort();
    if (this.dialog.open) this.dialog.close();
    this.element.remove();
  }

  private syncPanelCount() {
    const multipleTabs = this.group.panels.length > 1;
    if (!multipleTabs) {
      this.cycler.groupChanged();
      if (this.dialog.open) this.dialog.close();
    } else this.cycler.groupChanged();
    this.element.hidden = !multipleTabs;
    this.updateToggle();
  }

  private openDialog() {
    if (this.disposed || this.dialog.open || this.group.panels.length <= 1) return;
    this.seconds.value = String(this.cycler.secondsPerTab);
    this.clearError();
    this.updateDialogActions();
    this.cycler.pause('dialog');
    this.dialog.showModal();
    this.button.setAttribute('aria-expanded', 'true');
    this.seconds.focus();
  }

  private submit(event: SubmitEvent) {
    event.preventDefault();
    const seconds = Number(this.seconds.value);
    if (!Number.isInteger(seconds) || seconds < MIN_TAB_DWELL_SECONDS || seconds > MAX_TAB_DWELL_SECONDS) {
      this.error.textContent = `Enter a whole number from ${MIN_TAB_DWELL_SECONDS} to ${MAX_TAB_DWELL_SECONDS}.`;
      this.error.hidden = false;
      this.seconds.setAttribute('aria-invalid', 'true');
      this.seconds.focus();
      return;
    }
    if (!this.cycler.start(seconds)) return;
    this.dialog.close();
  }

  private dialogClosed() {
    this.button.setAttribute('aria-expanded', 'false');
    this.cycler.resume('dialog');
    this.updateDialogActions();
    this.updateToggle();
  }

  private clearError() {
    this.error.textContent = '';
    this.error.hidden = true;
    this.seconds.removeAttribute('aria-invalid');
  }

  private updateDialogActions() {
    const running = this.cycler.running;
    this.startButton.hidden = running;
    this.restartButton.hidden = !running;
    this.stopButton.hidden = !running;
  }

  private updateToggle() {
    const running = this.cycler.running;
    this.button.setAttribute('aria-pressed', String(running));
    this.button.title = running
      ? `Tab cycling · ${this.cycler.secondsPerTab}s per tab · open controls`
      : 'Cycle group tabs';
    this.button.dataset.running = String(running);
    this.updateDialogActions();
  }
}

function makeCycleIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ['M12.8 5.6A5.2 5.2 0 0 0 4 2.8L2.5 4.3', 'M2.5 1.8v2.5H5', 'M3.2 10.4A5.2 5.2 0 0 0 12 13.2l1.5-1.5', 'M13.5 14.2v-2.5H11']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function actionButton(text: string, className: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
}

function safeId(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, '-'); }

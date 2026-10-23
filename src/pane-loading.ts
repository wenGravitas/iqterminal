export type PaneDataState = { kind: 'loading' | 'empty' | 'error'; title: string; detail?: string };

/** Shared, non-interactive feedback for panes that have no usable data yet. */
export class PaneLoading {
  readonly element = document.createElement('div');
  private title = document.createElement('span');
  private detail = document.createElement('small');
  constructor() {
    this.element.className = 'pane-data-state'; this.element.hidden = true;
    this.element.setAttribute('role', 'status'); this.element.setAttribute('aria-live', 'polite');
    const signal = document.createElement('span'); signal.className = 'pane-loading-signal'; signal.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 5; index++) { const bar = document.createElement('i'); bar.style.setProperty('--loading-step', String(index)); signal.append(bar); }
    const copy = document.createElement('span'); copy.className = 'pane-loading-copy'; copy.append(this.title, this.detail);
    this.element.append(signal, copy);
  }
  update(state: PaneDataState | null) {
    this.element.hidden = state === null;
    if (!state) { this.element.removeAttribute('aria-busy'); return; }
    this.element.dataset.state = state.kind;
    this.element.setAttribute('aria-label', [state.title, state.detail].filter(Boolean).join(' · '));
    this.element.setAttribute('aria-busy', String(state.kind === 'loading'));
    if (this.title.textContent !== state.title) this.title.textContent = state.title;
    if (this.detail.textContent !== (state.detail ?? '')) this.detail.textContent = state.detail ?? '';
    this.detail.hidden = !state.detail;
  }
}

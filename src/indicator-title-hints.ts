type TitleHintRoot = { includeAllTitles?: boolean };

const INDICATOR_HINT_SCOPE = [
  '.active-indicators',
  '.pane-indicator-layer',
  '.indicator-picker',
  '.indicator-settings:not(.chart-settings):not(.drawing-settings-dialog)',
  '.open-interest-settings',
  '.cvd-controls', '.cvd-status', '.open-interest-toolbar', '.open-interest-status', '.open-interest-provenance',
  '.order-flow-chrome', '.market-conditions-surface', '.liquidation-legend', '.liquidation-pane-status',
  '.trade-bubbles-status', '.effort-status', '[data-cvd]', '[data-open-interest]', '[data-market-conditions]',
].join(',');

interface CurrentHint {
  root: HTMLElement;
  element: HTMLElement;
  latestTitle: string | null;
  info: boolean;
  pinned: boolean;
  hovered: boolean;
  focused: boolean;
  dismissed: boolean;
  ignoreOwnRemoval: boolean;
  observer: MutationObserver;
  originalDescribedBy: string | null;
}

/** Delays native title hints in indicator UI and draws one consistent, cancellable hint. */
export class IndicatorTitleHints {
  readonly tooltip = document.createElement('div');
  private roots = new Map<HTMLElement, AbortController>();
  private rootMutations = new Map<HTMLElement, MutationObserver>();
  private current?: CurrentHint;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private keyboardNavigation = false;

  constructor(private readonly delayMs = 500) {
    this.tooltip.className = 'indicator-title-tooltip';
    this.tooltip.id = `indicator-title-tooltip-${crypto.randomUUID()}`;
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.hidden = true;
    document.body.append(this.tooltip);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    document.addEventListener('keydown', this.onDocumentKeyDown, true);
  }

  addRoot(root: HTMLElement, options: TitleHintRoot = {}) {
    if (this.disposed || this.roots.has(root)) return () => {};
    const abort = new AbortController();
    this.roots.set(root, abort);
    const signal = abort.signal;
    root.addEventListener('pointerover', event => this.onPointerOver(root, event as PointerEvent, options), { capture: true, signal });
    root.addEventListener('pointerout', event => this.onPointerOut(event as PointerEvent), { capture: true, signal });
    root.addEventListener('focusin', event => this.onFocusIn(root, event, options), { capture: true, signal });
    root.addEventListener('focusout', event => this.onFocusOut(event), { capture: true, signal });
    for (const type of ['pointerdown', 'mousedown', 'click', 'wheel', 'dragstart'] as const) {
      root.addEventListener(type, event => {
        const info = this.infoTarget(event.target, root);
        if (info) {
          event.stopPropagation();
          if (type === 'pointerdown' || type === 'mousedown') this.keyboardNavigation = false;
          if (type === 'click') { event.preventDefault(); this.toggleInfo(root, info); }
          return;
        }
        if (type === 'pointerdown' || type === 'mousedown') this.keyboardNavigation = false;
        this.dismissCurrent();
      }, { capture: true, signal, passive: type === 'wheel' });
    }
    root.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape') this.dismissCurrent(); else if ((event as KeyboardEvent).key === 'Tab') this.keyboardNavigation = true; }, { capture: true, signal });
    root.addEventListener('close', event => { if (event.target instanceof HTMLDialogElement && this.current?.element.closest('dialog') === event.target) this.clearCurrent(); }, { capture: true, signal });
    const observer = new MutationObserver(records => {
      const current = this.current;
      if (current?.root !== root || !current.info) return;
      const removed = records.some(record => record.type === 'childList' && [...record.removedNodes].some(node =>
        node === current.element || node instanceof Element && node.contains(current.element)));
      const hidden = records.some(record => record.type === 'attributes' && record.attributeName === 'hidden'
        && record.target instanceof HTMLElement && record.target.hidden && record.target.contains(current.element));
      if (removed && !current.element.isConnected || hidden) this.clearCurrent();
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    this.rootMutations.set(root, observer);
    return () => this.removeRoot(root);
  }

  private onPointerOver(root: HTMLElement, event: PointerEvent, options: TitleHintRoot) {
    if (event.pointerType === 'touch') return;
    const eventElement = event.target instanceof Element ? event.target : null;
    const candidate = this.titleTarget(event.target, root, options);
    const current = this.current;
    const insideCurrent = current?.root === root && current.hovered && eventElement && current.element.contains(eventElement);
    const element = insideCurrent ? candidate && candidate !== current.element && current.element.contains(candidate) ? candidate : current.element : candidate;
    if (!element) return;
    this.enter(element, 'pointer');
  }

  private onPointerOut(event: PointerEvent) {
    const current = this.current;
    if (!current || !current.hovered) return;
    const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (related && current.element.contains(related)) return;
    current.hovered = false;
    this.finishIfOutside();
  }

  private onFocusIn(root: HTMLElement, event: FocusEvent, options: TitleHintRoot) {
    const eventElement = event.target instanceof Element ? event.target : null;
    const candidate = this.titleTarget(event.target, root, options);
    const current = this.current;
    const insideCurrent = current?.root === root && current.focused && eventElement && current.element.contains(eventElement);
    const element = insideCurrent ? candidate && candidate !== current.element && current.element.contains(candidate) ? candidate : current.element : candidate;
    if (element) this.enter(element, 'focus');
  }

  private onFocusOut(event: FocusEvent) {
    const current = this.current;
    if (!current || !current.focused) return;
    const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (related && current.element.contains(related)) return;
    current.focused = false;
    this.finishIfOutside();
  }

  private titleTarget(target: EventTarget | null, root: HTMLElement, options: TitleHintRoot) {
    const element = target instanceof Element ? target.closest<HTMLElement>('[title]') : null;
    if (!element || element !== root && !root.contains(element)) return undefined;
    if (!options.includeAllTitles && !element.closest(INDICATOR_HINT_SCOPE)) return undefined;
    const title = element.getAttribute('title');
    if (this.current?.element !== element && (title === null || !title.trim())) return undefined;
    return element;
  }

  private infoTarget(target: EventTarget | null, root: HTMLElement) {
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-indicator-info]') : null;
    return element && (element === root || root.contains(element)) ? element : undefined;
  }

  private toggleInfo(root: HTMLElement, element: HTMLElement) {
    const current = this.current;
    if (current?.element === element && current.info) {
      if (current.pinned) this.clearCurrent();
      else { current.pinned = true; current.hovered = false; this.show(current); }
      return;
    }
    this.clearCurrent();
    this.createCurrent(element, root, true);
    const opened = this.current;
    if (!opened) return;
    opened.pinned = true;
    opened.focused = document.activeElement === element;
    this.show(opened);
  }

  private enter(element: HTMLElement, kind: 'pointer' | 'focus') {
    if (this.disposed) return;
    if (this.current?.element !== element) {
      this.clearCurrent();
      const title = element.getAttribute('title');
      if (title === null || !title.trim()) return;
      this.createCurrent(element, this.findRootFor(element) ?? element, element.hasAttribute('data-indicator-info'));
    }
    const current = this.current;
    if (!current) return;
    if (kind === 'pointer') current.hovered = true;
    else current.focused = true;
    if (kind === 'focus' && this.keyboardNavigation) this.show(current);
    else if (!current.dismissed && !this.tooltip.hidden) this.position(current.element);
    else if (!current.dismissed && this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (this.current === current && current.hovered && !current.dismissed) this.show(current);
      }, this.delayMs);
    }
  }

  private createCurrent(element: HTMLElement, root: HTMLElement, info: boolean) {
    const title = element.getAttribute('title');
    if (title === null || !title.trim()) return;
    const current: CurrentHint = {
      root, element, latestTitle: title, info, pinned: false, hovered: false, focused: false, dismissed: false, ignoreOwnRemoval: false,
      originalDescribedBy: element.getAttribute('aria-describedby'),
      observer: new MutationObserver(() => this.titleChanged(current)),
    };
    element.removeAttribute('title');
    current.observer.observe(element, { attributes: true, attributeFilter: ['title'], attributeOldValue: true });
    this.current = current;
  }

  private titleChanged(current: CurrentHint) {
    if (this.current !== current) return;
    const title = current.element.getAttribute('title');
    if (title === null) {
      if (current.ignoreOwnRemoval) current.ignoreOwnRemoval = false;
      else current.latestTitle = null;
      if (current.latestTitle === null) { this.tooltip.hidden = true; this.restoreTooltipToBody(); }
      return;
    }
    current.latestTitle = title;
    current.ignoreOwnRemoval = true;
    current.element.removeAttribute('title');
    if (title.trim() && !current.dismissed && !this.tooltip.hidden) this.show(current);
    else { this.tooltip.hidden = true; this.restoreTooltipToBody(); }
  }

  private show(current: CurrentHint) {
    if (this.current !== current || current.dismissed || !current.latestTitle?.trim()) return;
    if (!this.isVisible(current.root) || !this.isVisible(current.element) || document.hidden) { this.clearCurrent(); return; }
    const modal = current.element.closest<HTMLDialogElement>('dialog[open]');
    const parent = modal ?? document.body;
    if (this.tooltip.parentElement !== parent) parent.append(this.tooltip);
    this.tooltip.textContent = current.latestTitle;
    this.tooltip.hidden = false;
    if (current.info) current.element.setAttribute('aria-expanded', 'true');
    if (current.focused || current.info) {
      const ids = new Set((current.element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
      ids.add(this.tooltip.id);
      current.element.setAttribute('aria-describedby', [...ids].join(' '));
    }
    this.position(current.element);
  }

  private position(element: HTMLElement) {
    if (this.tooltip.hidden) return;
    const box = element.getBoundingClientRect();
    const width = this.tooltip.offsetWidth, height = this.tooltip.offsetHeight;
    const left = Math.max(4, Math.min(window.innerWidth - width - 4, box.left + box.width / 2 - width / 2));
    const top = box.bottom + height + 8 <= window.innerHeight ? box.bottom + 6 : Math.max(4, box.top - height - 6);
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private dismissCurrent() {
    const current = this.current;
    if (!current) return;
    if (current.info) { this.clearCurrent(); return; }
    current.dismissed = true;
    this.cancelTimer();
    this.tooltip.hidden = true;
    this.restoreTooltipToBody();
  }

  private finishIfOutside() {
    if (this.current && !this.current.pinned && !this.current.hovered && !this.current.focused) this.clearCurrent();
  }

  private clearCurrent() {
    this.cancelTimer();
    const current = this.current;
    if (!current) { this.tooltip.hidden = true; this.restoreTooltipToBody(); return; }
    this.current = undefined;
    const pendingMutations = current.observer.takeRecords();
    const actualTitle = current.element.getAttribute('title');
    if (actualTitle !== null) current.latestTitle = actualTitle;
    else if (pendingMutations.length && !current.ignoreOwnRemoval) current.latestTitle = null;
    current.observer.disconnect();
    if (current.info) current.element.setAttribute('aria-expanded', 'false');
    const describedBy = (current.element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== this.tooltip.id);
    if (current.focused && current.originalDescribedBy) describedBy.push(...current.originalDescribedBy.split(/\s+/).filter(Boolean));
    if (describedBy.length) current.element.setAttribute('aria-describedby', [...new Set(describedBy)].join(' '));
    else current.element.removeAttribute('aria-describedby');
    if (current.latestTitle === null) current.element.removeAttribute('title');
    else current.element.setAttribute('title', current.latestTitle);
    this.tooltip.hidden = true;
    this.restoreTooltipToBody();
  }

  private restoreTooltipToBody() {
    if (this.tooltip.parentElement !== document.body) document.body.append(this.tooltip);
  }

  private cancelTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private onVisibilityChange = () => { if (document.hidden) this.clearCurrent(); };
  private onDocumentPointerDown = (event: PointerEvent) => {
    const current = this.current;
    if (!current?.info || !current.pinned) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && (current.element.contains(target) || this.tooltip.contains(target))) return;
    this.clearCurrent();
  };
  private onDocumentKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && this.current) this.clearCurrent(); };

  private findRootFor(element: HTMLElement) {
    for (const root of this.roots.keys()) if (root === element || root.contains(element)) return root;
    return undefined;
  }

  private isVisible(element: HTMLElement) {
    if (!element.isConnected || element.closest('[hidden]') || element.matches('dialog') && !(element as HTMLDialogElement).open || element.getClientRects().length === 0) return false;
    for (let cursor: HTMLElement | null = element; cursor; cursor = cursor.parentElement) {
      const style = getComputedStyle(cursor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  }

  clear() { this.clearCurrent(); }

  removeRoot(root: HTMLElement) {
    this.roots.get(root)?.abort();
    this.roots.delete(root);
    this.rootMutations.get(root)?.disconnect();
    this.rootMutations.delete(root);
    if (this.current && (this.current.element === root || root.contains(this.current.element))) this.clearCurrent();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const root of this.roots.keys()) this.roots.get(root)?.abort();
    this.roots.clear();
    for (const observer of this.rootMutations.values()) observer.disconnect();
    this.rootMutations.clear();
    this.clearCurrent();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    document.removeEventListener('keydown', this.onDocumentKeyDown, true);
    this.tooltip.remove();
  }
}

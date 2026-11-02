import { drawingToolIcon, ICON_VIEWBOX } from 'openalgo-charts/draw';
import { FOLDER_DRAWING_ICONS, FOLDER_LETTER_ICONS, FOLDER_NUMBER_ICONS } from './folder-sidebar-icons';

export function folderSidebarGlyph(value: string): SVGSVGElement | HTMLSpanElement {
  if (!value.startsWith('drawing:')) {
    const text = document.createElement('span'); text.textContent = value; text.setAttribute('aria-hidden', 'true'); return text;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', ICON_VIEWBOX); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', drawingToolIcon(value.slice(8)) ?? ''); svg.append(path); return svg;
}

/** A bounded native DOM picker; its document listeners share the panel lifecycle. */
export class FolderIconPicker {
  readonly element = document.createElement('div');
  private abort = new AbortController();
  private anchor?: HTMLElement;
  private choose?: (icon: string) => void;

  constructor() {
    this.element.className = 'folder-icon-picker'; this.element.hidden = true;
    this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-label', 'Folder sidebar icon');
    const options = { signal: this.abort.signal };
    this.element.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-folder-icon]');
      if (!button) return;
      this.choose?.(button.dataset.folderIcon!); this.close(true);
    }, options);
    document.addEventListener('pointerdown', event => {
      if (!this.element.hidden && !this.element.contains(event.target as Node) && !this.anchor?.contains(event.target as Node)) this.close();
    }, { ...options, capture: true });
    document.addEventListener('keydown', event => {
      if (this.element.hidden || event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); this.close(true);
    }, { ...options, capture: true });
    this.element.addEventListener('keydown', event => {
      const buttons = [...this.element.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const delta = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 } as Record<string, number>)[event.key];
      if (delta === undefined) return;
      event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, index + delta))]?.focus();
    }, options);
    window.addEventListener('resize', () => this.close(), options);
  }

  open(anchor: HTMLElement, selected: string, choose: (icon: string) => void) {
    this.anchor = anchor; this.choose = choose;
    this.element.replaceChildren();
    for (const [label, values] of [['Drawing icons', FOLDER_DRAWING_ICONS], ['Letters', FOLDER_LETTER_ICONS], ['Numbers', FOLDER_NUMBER_ICONS]] as const) {
      const heading = document.createElement('h3'); heading.textContent = label;
      const grid = document.createElement('div'); grid.className = 'folder-icon-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', label);
      for (const value of values) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.folderIcon = value;
        const name = value.startsWith('drawing:') ? value.slice(8).replaceAll('-', ' ') : value;
        button.title = name; button.setAttribute('aria-label', name); button.setAttribute('aria-pressed', String(value === selected));
        button.append(folderSidebarGlyph(value)); grid.append(button);
      }
      this.element.append(heading, grid);
    }
    document.body.append(this.element); this.element.hidden = false;
    const rect = anchor.getBoundingClientRect();
    this.element.style.left = `${Math.max(4, Math.min(innerWidth - this.element.offsetWidth - 4, rect.left - this.element.offsetWidth))}px`;
    this.element.style.top = `${Math.max(4, Math.min(innerHeight - this.element.offsetHeight - 4, rect.top))}px`;
    this.element.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }

  close(restoreFocus = false) {
    this.element.hidden = true;
    if (restoreFocus && this.anchor?.isConnected) this.anchor.focus();
    this.choose = undefined;
  }
  dispose() { this.abort.abort(); this.element.remove(); }
}

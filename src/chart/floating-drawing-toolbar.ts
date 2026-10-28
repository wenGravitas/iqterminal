export interface FloatingDrawingToolbarSettings { visible: boolean; tools: string[]; x: number; y: number }
export const DRAWING_TOOL_DRAG_TYPE = 'application/x-iqterminal-drawing-tool';
export function floatingDrawingToolbarSettings(value: unknown, allowed: ReadonlySet<string>): FloatingDrawingToolbarSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const coordinate = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  return { visible: raw.visible === true, tools: [...new Set(Array.isArray(raw.tools) ? raw.tools.filter((id): id is string => typeof id === 'string' && allowed.has(id)) : [])], x: coordinate(raw.x, .55), y: coordinate(raw.y, .14) };
}

/** Pins refer to the original tool IDs, so selection uses the existing native settings/templates. */
export class FloatingDrawingToolbar {
  readonly element = document.createElement('div');
  private toolsElement = document.createElement('div');
  private emptyPrompt = document.createElement('span');
  private dragPreview?: HTMLElement;
  private dragPreviewFrame = 0;
  private handle: HTMLButtonElement;
  private abort = new AbortController();
  private observer: ResizeObserver;
  private state: FloatingDrawingToolbarSettings;
  private active: string | null = null;
  private erasing = false;
  private drag?: { pointer: number; clientX: number; clientY: number; x: number; y: number; original: FloatingDrawingToolbarSettings };

  constructor(private host: HTMLElement, private toggle: HTMLButtonElement, sources: HTMLElement[], private allowed: ReadonlySet<string>, value: unknown,
    private button: (tool: string) => HTMLButtonElement, private activate: (tool: string | null) => void, private erase: () => void,
    private changed: (value: FloatingDrawingToolbarSettings) => void, private pinned: () => void, id: string) {
    this.state = floatingDrawingToolbarSettings(value, allowed);
    this.element.id = id; this.element.className = 'floating-drawing-toolbar'; this.element.setAttribute('role', 'toolbar'); this.element.setAttribute('aria-label', 'Floating drawing toolbar');
    this.handle = button('move'); this.handle.classList.add('floating-drawing-handle'); this.handle.setAttribute('aria-description', 'Drag to move. Arrow keys move the toolbar; Shift moves one pixel.');
    this.emptyPrompt.className = 'floating-drawing-empty'; this.emptyPrompt.textContent = 'Drag drawing tools here';
    this.toolsElement.className = 'floating-drawing-tools'; this.element.append(this.handle, this.toolsElement); host.append(this.element);
    toggle.setAttribute('aria-controls', id);
    const options = { signal: this.abort.signal };
    toggle.addEventListener('click', () => this.commit({ ...this.state, visible: !this.state.visible }), options);
    // Keep toolbar gestures out of the chart's pointer-captured pan/drawing input.
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'dblclick', 'wheel', 'contextmenu'] as const) this.element.addEventListener(type, event => event.stopPropagation(), options);
    this.element.addEventListener('click', event => {
      event.stopPropagation(); const tool = (event.target as Element).closest<HTMLElement>('[data-floating-tool]')?.dataset.floatingTool;
      if (!tool) return;
      if (event.altKey && allowed.has(tool)) this.remove(tool);
      else if (tool === 'eraser') erase(); else activate(tool === 'cursor' ? null : tool);
    }, options);
    this.element.addEventListener('keydown', event => {
      event.stopPropagation();
      const tool = (event.target as HTMLElement).dataset.floatingTool;
      if ((event.key === 'Delete' || event.key === 'Backspace') && tool && allowed.has(tool)) { event.preventDefault(); this.remove(tool); this.toolsElement.querySelector<HTMLButtonElement>('button')?.focus(); }
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && tool && allowed.has(tool)) {
        event.preventDefault(); const tools = [...this.state.tools], from = tools.indexOf(tool), to = from + (event.key === 'ArrowLeft' ? -1 : 1);
        if (from >= 0 && to >= 0 && to < tools.length) { [tools[from], tools[to]] = [tools[to]!, tools[from]!]; this.commit({ ...this.state, tools }); [...this.toolsElement.querySelectorAll<HTMLButtonElement>('[data-floating-tool]')].find(button => button.dataset.floatingTool === tool)?.focus(); }
      }
      if (event.key === 'Escape') { event.preventDefault(); if (this.drag) this.endMove(false); else activate(null); }
    }, options);
    this.handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return; event.preventDefault();
      this.drag = { pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: this.element.offsetLeft, y: this.element.offsetTop, original: structuredClone(this.state) };
      this.handle.setPointerCapture(event.pointerId); this.element.classList.add('is-moving');
    }, options);
    this.handle.addEventListener('pointermove', event => {
      if (this.drag?.pointer !== event.pointerId) return;
      this.move(this.drag.x + event.clientX - this.drag.clientX, this.drag.y + event.clientY - this.drag.clientY);
    }, options);
    this.handle.addEventListener('pointerup', event => { if (this.drag?.pointer === event.pointerId) this.endMove(true); }, options);
    this.handle.addEventListener('pointercancel', () => this.endMove(false), options);
    this.handle.addEventListener('lostpointercapture', () => this.endMove(false), options);
    this.handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); const step = event.shiftKey ? 1 : 10;
      this.move(this.element.offsetLeft + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), this.element.offsetTop + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
      this.changed(structuredClone(this.state));
    }, options);
    const clearDrop = () => this.element.classList.remove('is-drag-over');
    const endToolDrag = () => { clearDrop(); this.clearDragPreview(); };
    this.element.addEventListener('dragover', event => { if (!event.dataTransfer?.types.includes(DRAWING_TOOL_DRAG_TYPE)) return; event.preventDefault(); event.stopPropagation(); this.element.classList.add('is-drag-over'); }, options);
    this.element.addEventListener('dragleave', event => { if (!(event.relatedTarget instanceof Node) || !this.element.contains(event.relatedTarget)) clearDrop(); }, options);
    this.element.addEventListener('drop', event => {
      if (!event.dataTransfer?.types.includes(DRAWING_TOOL_DRAG_TYPE)) return;
      event.preventDefault(); event.stopPropagation(); endToolDrag();
      let payload: { tool?: unknown; owner?: unknown };
      try { payload = JSON.parse(event.dataTransfer.getData(DRAWING_TOOL_DRAG_TYPE)); } catch { return; }
      if (!payload || typeof payload.tool !== 'string' || !allowed.has(payload.tool)) return;
      const tool = payload.tool, moving = payload.owner === id;
      if (!moving && this.state.tools.includes(tool)) return;
      const target = (event.target as Element).closest<HTMLElement>('[data-floating-tool]');
      let before = target?.dataset.floatingTool;
      if (before === tool) return;
      const tools = this.state.tools.filter(value => value !== tool);
      let index = before ? tools.indexOf(before) : -1;
      if (index >= 0 && target && event.clientX > target.getBoundingClientRect().left + target.offsetWidth / 2) index++;
      tools.splice(index < 0 ? tools.length : index, 0, tool);
      this.commit({ ...this.state, tools, visible: true }); pinned();
    }, options);
    this.element.addEventListener('dragstart', event => {
      const source = (event.target as Element).closest<HTMLElement>('[data-floating-tool]'), tool = source?.dataset.floatingTool;
      if (!source || !tool || !allowed.has(tool) || !event.dataTransfer) return;
      event.stopPropagation(); event.dataTransfer.setData(DRAWING_TOOL_DRAG_TYPE, JSON.stringify({ tool, owner: id })); event.dataTransfer.effectAllowed = 'move';
      this.setToolDragImage(event, source, tool);
    }, options);
    this.element.addEventListener('dragend', endToolDrag, options);
    for (const source of sources) {
      for (const toolButton of source.querySelectorAll<HTMLButtonElement>('[data-drawing-tool]')) {
        toolButton.draggable = true; toolButton.setAttribute('aria-description', 'Drag to the floating drawing toolbar, or press Shift+Enter to pin.');
        toolButton.title += ' · Drag to floating toolbar · Shift+Enter to pin';
      }
      source.addEventListener('dragstart', event => {
        const toolSource = (event.target as Element).closest<HTMLElement>('[data-drawing-tool]'), tool = toolSource?.dataset.drawingTool;
        if (!toolSource || !tool || !allowed.has(tool) || !event.dataTransfer) return;
        event.dataTransfer.setData(DRAWING_TOOL_DRAG_TYPE, JSON.stringify({ tool })); event.dataTransfer.effectAllowed = 'copy';
        this.setToolDragImage(event, toolSource, tool);
      }, options);
      source.addEventListener('dragend', endToolDrag, options);
      source.addEventListener('keydown', event => {
        if (!event.shiftKey || event.key !== 'Enter') return;
        const tool = (event.target as Element).closest<HTMLElement>('[data-drawing-tool]')?.dataset.drawingTool;
        if (!tool || !allowed.has(tool)) return;
        event.preventDefault(); event.stopPropagation(); this.commit({ ...this.state, visible: true, tools: [...this.state.tools, tool] }); pinned();
      }, options);
    }
    this.observer = new ResizeObserver(() => this.position()); this.observer.observe(host); this.observer.observe(this.element);
    this.render();
  }
  sync(active: string | null, erasing: boolean) {
    this.active = active; this.erasing = erasing;
    for (const button of this.toolsElement.querySelectorAll<HTMLButtonElement>('[data-floating-tool]')) {
      const tool = button.dataset.floatingTool;
      button.setAttribute('aria-pressed', String(tool === 'cursor' ? !active && !erasing : tool === 'eraser' ? erasing : active === tool));
    }
  }
  private commit(value: FloatingDrawingToolbarSettings) { this.state = floatingDrawingToolbarSettings(value, this.allowed); this.render(); this.changed(structuredClone(this.state)); }
  private remove(tool: string) { this.commit({ ...this.state, tools: this.state.tools.filter(value => value !== tool) }); }
  private render() {
    this.element.hidden = !this.state.visible; this.toggle.setAttribute('aria-pressed', String(this.state.visible)); this.toggle.setAttribute('aria-expanded', String(this.state.visible));
    this.toolsElement.replaceChildren(...['cursor', 'eraser', ...this.state.tools].map(tool => {
      const button = this.button(tool); button.dataset.floatingTool = tool;
      if (this.allowed.has(tool)) { button.draggable = true; button.title += ' · Drag or Alt+Left/Right to reorder · Alt-click or Delete to remove from toolbar'; }
      return button;
    }));
    if (!this.state.tools.length) this.toolsElement.append(this.emptyPrompt);
    this.sync(this.active, this.erasing); this.position();
  }
  private setToolDragImage(event: DragEvent, source: HTMLElement, tool: string) {
    this.clearDragPreview();
    const preview = document.createElement('div'); preview.className = 'drawing-tool-drag-preview'; preview.setAttribute('aria-hidden', 'true');
    const icon = source.querySelector('svg'); if (icon) preview.append(icon.cloneNode(true));
    const label = document.createElement('span');
    label.textContent = (source.getAttribute('aria-label') ?? tool).replace(/^Use /, '').replace(/ tool$/, '');
    preview.append(label);
    // Native drag snapshots need a rendered element, with explicit theme colours.
    const style = getComputedStyle(this.host);
    preview.style.backgroundColor = style.getPropertyValue('--chrome').trim();
    preview.style.color = style.getPropertyValue('--text').trim();
    preview.style.borderColor = style.getPropertyValue('--divider').trim();
    document.body.append(preview); this.dragPreview = preview;
    preview.style.left = `${Math.max(4, Math.min(window.innerWidth - preview.offsetWidth - 4, event.clientX + 12))}px`;
    preview.style.top = `${Math.max(4, Math.min(window.innerHeight - preview.offsetHeight - 4, event.clientY + 12))}px`;
    event.dataTransfer?.setDragImage(preview, 12, 14);
    // Chromium captures after dragstart dispatch, before the next animation frame.
    this.dragPreviewFrame = requestAnimationFrame(() => this.clearDragPreview());
  }
  private clearDragPreview() {
    if (this.dragPreviewFrame) cancelAnimationFrame(this.dragPreviewFrame);
    this.dragPreviewFrame = 0; this.dragPreview?.remove(); this.dragPreview = undefined;
  }
  private move(x: number, y: number) {
    const width = Math.max(0, this.host.clientWidth - this.element.offsetWidth - 16), height = Math.max(0, this.host.clientHeight - this.element.offsetHeight - 16);
    this.state = { ...this.state, x: width ? Math.max(0, Math.min(1, (x - 8) / width)) : 0, y: height ? Math.max(0, Math.min(1, (y - 8) / height)) : 0 }; this.position();
  }
  private position() {
    if (this.element.hidden) return;
    this.element.style.left = `${8 + this.state.x * Math.max(0, this.host.clientWidth - this.element.offsetWidth - 16)}px`;
    this.element.style.top = `${8 + this.state.y * Math.max(0, this.host.clientHeight - this.element.offsetHeight - 16)}px`;
  }
  private endMove(commit: boolean) {
    if (!this.drag) return;
    const drag = this.drag; this.drag = undefined;
    if (this.handle.hasPointerCapture(drag.pointer)) this.handle.releasePointerCapture(drag.pointer);
    this.element.classList.remove('is-moving');
    if (commit) this.changed(structuredClone(this.state)); else { this.state = drag.original; this.position(); }
  }
  dispose() { this.clearDragPreview(); this.endMove(false); this.abort.abort(); this.observer.disconnect(); this.element.remove(); }
}

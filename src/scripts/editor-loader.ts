import type { IDockviewPanelProps, IContentRenderer } from 'dockview-core';
import type { CandlePanel } from '../panel';
import type { ScriptLibrary } from './library';

export interface EditorTarget {
  id: string;
  panel: CandlePanel;
}

/** Dockview host that loads the full editor only when its panel is opened/restored. */
export class LazyScriptEditorPanel implements IContentRenderer {
  readonly element = document.createElement('div');
  private dead = false;
  private editor?: { init(params: IDockviewPanelProps): void; refreshTargets(): void; dispose(): void };
  private pendingRefresh = false;

  constructor(
    private readonly library: ScriptLibrary,
    private readonly targets: () => EditorTarget[],
    private readonly save: () => void,
  ) {
    this.element.className = 'script-editor-loading';
    this.element.textContent = 'Loading OpenScript editor…';
  }

  init(params: IDockviewPanelProps) {
    void import('./editor').then(({ ScriptEditorPanel }) => {
      if (this.dead) return;
      const editor = new ScriptEditorPanel(this.library, this.targets, this.save);
      this.editor = editor;
      this.element.replaceChildren(editor.element);
      editor.init(params);
      if (this.pendingRefresh) editor.refreshTargets();
    }).catch(() => {
      if (!this.dead) this.element.textContent = 'OpenScript editor could not load. Close and reopen this panel to retry.';
    });
  }

  refreshTargets() {
    if (this.dead) return;
    if (this.editor) this.editor.refreshTargets();
    else this.pendingRefresh = true;
  }

  dispose() {
    this.dead = true;
    this.editor?.dispose();
    this.editor = undefined;
  }
}

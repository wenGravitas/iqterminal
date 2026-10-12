import { DefaultTab, type DockviewApi, type GroupPanelPartInitParameters } from 'dockview-core';
import { canonicalSeries, instrumentLabel, instrumentOf, marketOf } from './feed/protocol';

/** Decorate Dockview's stock tab so close, drag, focus and context menus stay native. */
export class CompactChartTab extends DefaultTab {
  override init(params: GroupPanelPartInitParameters) {
    super.init(params);
    const render = () => {
      const content = this.element.querySelector<HTMLElement>('.dv-default-tab-content')!;
      const series = params.api.component === 'candle' ? canonicalSeries(params.api.getParameters()) : null;
      const position = params.api.group.panels.findIndex(panel => panel.id === params.api.id) + 1;
      const number = document.createElement('span'); number.className = 'chart-tab-number'; number.textContent = position > 0 ? String(position) : '';
      number.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'chart-tab-ticker';
      label.textContent = series ? instrumentOf(series).native : params.api.title ?? 'OpenScript';
      if (series) {
        const logo = document.createElement('img'); logo.className = 'chart-tab-logo'; logo.alt = ''; logo.setAttribute('aria-hidden', 'true');
        logo.src = series.venue === 'binance' ? '/venues/binance.ico' : '/venues/hyperliquid.png';
        const market = document.createElement('span'); market.className = 'chart-tab-market'; market.textContent = marketOf(series) === 'spot' ? 'S' : 'P'; market.setAttribute('aria-hidden', 'true');
        content.replaceChildren(number, logo, label, market);
      } else content.replaceChildren(number, label);
      content.classList.add('compact-chart-tab');
      const fullTitle = series ? `${instrumentLabel(series)} · ${series.interval}` : params.api.title ?? 'OpenScript';
      this.element.title = `${fullTitle}${position > 0 && position <= 9 ? ` · Alt+${position}` : ''}`;
      this.element.setAttribute('aria-keyshortcuts', position > 0 && position <= 9 ? `Alt+${position}` : '');
    };
    this.addDisposables(params.api.onDidTitleChange(render), params.api.onDidParametersChange(render), params.api.onDidGroupChange(render), params.containerApi.onDidLayoutChange(render));
    render();
  }
}

/** Group-local shortcuts avoid browser Ctrl+number and never intercept editing. */
export function activateNumberedTab(dock: DockviewApi, event: KeyboardEvent) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || !/^[1-9]$/.test(event.key)) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input,textarea,select,[contenteditable="true"],dialog,[popover]') || document.querySelector('dialog[open]')) return;
  const panel = dock.activeGroup?.panels[Number(event.key) - 1];
  if (!panel) return;
  event.preventDefault(); panel.api.setActive();
}

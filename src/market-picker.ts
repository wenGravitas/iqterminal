import { readMarketGroups, saveMarketGroup } from './market-groups';
import type { CvdGroup } from './feed/cvd';
import { markets, marketName } from './markets';
import type { ConnectionKey } from './feed/protocol';
/** Apply/Cancel drafts never mutate the host selection before Apply. */
export class MarketPicker {
  readonly element = document.createElement('dialog');
  private search = document.createElement('input');
  private list = document.createElement('div');
  private selected = document.createElement('p');
  private groupList=document.createElement('div');
  private groupField=document.createElement('div');
  private groupName=document.createElement('input');
  private groupStatus=document.createElement('p');
  private draftGroups=new Map<string,CvdGroup>();
  private apply = document.createElement('button');
  private radioName = `market-${crypto.randomUUID()}`;
  private draft = new Set<ConnectionKey>();
  private options?: { multiple: boolean; capability: 'candles' | 'executions' | 'liquidations'; allowed?: ConnectionKey[]; groups?: CvdGroup[]; applyGroups?: (groups:CvdGroup[])=>void; apply(ids: ConnectionKey[]): void };
  private abort = new AbortController();
  constructor(parent: HTMLElement) {
    this.element.className = 'market-picker indicator-picker'; this.element.setAttribute('aria-label', 'Select markets');
    const header = document.createElement('header'), title = document.createElement('h2'); title.textContent = 'Markets'; header.append(title);
    this.search.type = 'search'; this.search.placeholder = 'Search symbol or venue'; this.search.setAttribute('aria-label', 'Search markets');
    const searchLabel = document.createElement('label'); searchLabel.className = 'indicator-search'; searchLabel.append(this.search);
    this.list.className = 'market-picker-list'; this.selected.className = 'market-selection'; this.selected.setAttribute('aria-live', 'polite');
    const footer = document.createElement('footer'), cancel = document.createElement('button'); cancel.textContent = 'Cancel'; this.apply.textContent = 'Apply'; this.apply.className = 'primary'; footer.append(cancel, this.apply);
    this.groupList.className='market-picker-groups';
    this.groupField.className='market-picker-group-save';
    this.groupName.placeholder='Aggregation name';this.groupName.maxLength=60;this.groupName.setAttribute('aria-label','Aggregation name');
    const save=document.createElement('button');save.type='button';save.textContent='Save selected markets';save.setAttribute('aria-label','Save selection as aggregation');
    this.groupStatus.className='dialog-status';this.groupStatus.setAttribute('role','status');
    this.groupField.append(this.groupName,save);
    save.addEventListener('click',()=>{try{const group=saveMarketGroup(this.groupName.value,[...this.draft]);this.draftGroups.set(group.id,group);this.groupName.value='';this.groupStatus.textContent='Saved. Apply to use an independent copy in this indicator.';this.render();}catch(error){this.groupStatus.textContent=error instanceof Error?error.message:String(error);}});
    this.element.append(header, searchLabel, this.list, this.groupList, this.groupField, this.groupStatus, this.selected, footer); parent.append(this.element);
    const opt = { signal: this.abort.signal };
    this.search.addEventListener('input', () => this.render(), opt); cancel.addEventListener('click', () => this.element.close(), opt);
    this.apply.addEventListener('click', () => { this.options?.apply([...this.draft]); this.options?.applyGroups?.([...this.draftGroups.values()]); this.element.close(); }, opt);
  }
  open(ids: ConnectionKey[], options: NonNullable<MarketPicker['options']>) {
    this.options = options; this.draft = new Set(ids); this.draftGroups=new Map(options.groups?.map(group=>[group.id,structuredClone(group)])??[]);this.groupStatus.textContent=''; this.search.value = ''; this.render(); this.element.showModal(); this.search.focus();
  }
  private render() {
    const o = this.options; if (!o) return;
    const query = this.search.value.toLowerCase().trim(), fragment = document.createDocumentFragment();
    for (const m of markets) {
      if (!`${m.native} ${m.venue} ${m.marketType} ${m.base}`.toLowerCase().includes(query)) continue;
      const row = document.createElement('label'); row.className = 'market-choice';
      const input = document.createElement('input'); input.type = o.multiple ? 'checkbox' : 'radio'; input.name = this.radioName; input.checked = this.draft.has(m.id);
      input.disabled = !m[o.capability] || Boolean(o.allowed && !o.allowed.includes(m.id)); input.setAttribute('aria-label', m.label);
      const copy = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('small');
      title.textContent = `${m.venue} · ${m.native} · ${m.marketType}`;
      detail.textContent = input.disabled ? `${o.capability === 'liquidations' ? 'Actual liquidations' : o.capability === 'candles' ? 'Candles' : 'Live executions'} not available for this selection` : `${m.quote} price · ${m.base} quantity${m.settlement ? ` · ${m.settlement} settlement` : ''}`;
      copy.append(title, detail); row.append(input, copy); fragment.append(row);
      input.onchange = () => { if (!o.multiple) this.draft.clear(); if (input.checked) this.draft.add(m.id); else this.draft.delete(m.id); this.render(); this.list.querySelector<HTMLInputElement>(`input[aria-label="${m.label}"]`)?.focus(); };
    }
    this.list.replaceChildren(fragment);
    this.selected.textContent = this.draft.size ? `Selected: ${[...this.draft].map(marketName).join(' · ')}` : 'No markets selected';
    this.groupList.hidden=this.groupField.hidden=this.groupStatus.hidden=!o.applyGroups;
    this.groupList.replaceChildren();
    if(o.applyGroups){
      const title=document.createElement('strong');title.textContent='Named aggregations';this.groupList.append(title);
      const groups=new Map([...readMarketGroups(),...this.draftGroups.values()].map(group=>[group.id,group]));
      if(!groups.size){const hint=document.createElement('p');hint.className='dialog-status';hint.textContent='No saved aggregations. Select markets and save a named selection below.';this.groupList.append(hint);}
      for(const group of groups.values()){
        const label=document.createElement('label');label.className='market-choice';
        const input=document.createElement('input');input.type='checkbox';input.checked=this.draftGroups.has(group.id);input.setAttribute('aria-label',`Aggregation: ${group.name}`);
        input.onchange=()=>{if(input.checked){this.draftGroups.set(group.id,structuredClone(group));for(const id of group.markets)if(!o.allowed||o.allowed.includes(id))this.draft.add(id);}else this.draftGroups.delete(group.id);this.render();};
        label.append(input,document.createTextNode(group.name));this.groupList.append(label);
      }
      const hint=document.createElement('p');hint.className='dialog-status';hint.textContent='Selecting an aggregation adds its markets. Unselecting it keeps market inclusion unchanged. Apply stores independent group copies; only Markets checkboxes remove contributions.';this.groupList.append(hint);
    }
    this.apply.disabled = !o.multiple && this.draft.size !== 1;
  }
  dispose() { this.abort.abort(); if (this.element.open) this.element.close(); this.element.remove(); }
}

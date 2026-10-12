import { MarketPicker } from '../market-picker';
import { marketName } from '../markets';
import { TICKER_COLUMNS, SOUNDS, defaultTiers, validateTiers, type TickerConfig, type Tier, type TickerUnit } from './model';
import type { Notifications } from '../notifications';
import { tradeRow, tradeText } from './presentation';
function button(text: string, click: () => void) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = click; return b; }
function field(parent: HTMLElement, text: string, input: HTMLElement) { const l = document.createElement('label'); l.className = 'indicator-setting-field'; const span = document.createElement('span'); span.textContent = text; input.setAttribute('aria-label',text); l.append(span,input); parent.append(l); return input; }
export class TickerSettings {
  readonly element = document.createElement('dialog'); private picker: MarketPicker; private draft!: TickerConfig;
  private fields = document.createElement('div'); private tiers = document.createElement('div'); private error = document.createElement('p');
  private addTier?:HTMLButtonElement; private ladderUnit:TickerUnit='USDT'; private preview = document.createElement('div'); private scope = document.createElement('button'); private title = document.createElement('h2');
  constructor(parent: HTMLElement, private notifications: Notifications, private owner: () => string, private apply: (value: TickerConfig) => void) {
    this.element.className = 'indicator-settings ticker-settings'; this.element.setAttribute('aria-label','Trade Ticker settings');
    const form = document.createElement('div'); form.className = 'indicator-settings-form'; const header = document.createElement('header'); this.title.textContent = 'Trade Ticker'; header.append(this.title,button('Close',()=>this.element.close()));
    this.fields.className = 'indicator-settings-fields'; this.error.className = 'dialog-status'; this.error.setAttribute('role','status'); this.preview.className = 'ticker-tier-preview';
    const footer = document.createElement('footer'); footer.append(button('Cancel',()=>this.element.close()),button('Apply',()=>this.commit()));
    form.append(header,this.fields,this.error,footer); this.element.append(form); parent.append(this.element); this.picker = new MarketPicker(parent);
  }
  open(config: TickerConfig) { this.draft = structuredClone(config); this.error.textContent = ''; this.preview.replaceChildren(); this.render(); this.element.showModal(); }
  private input(parent: HTMLElement, name: string, key: string, value: string | number | boolean, type = 'text', change?: (v: any)=>void) {
    const i = document.createElement('input'); i.type = type; i.dataset.key = key;
    if (type === 'checkbox') i.checked = Boolean(value); else i.value = String(value);
    if(type==='number'){i.min='0';i.max='1000000000000';i.step='any';} if(type==='text')i.maxLength=60;
    i.onchange = () => change?.(type==='checkbox' ? i.checked : type==='number' ? Number(i.value) : i.value); field(parent,name,i); return i;
  }
  private select(parent: HTMLElement, name: string, values: string[], current: string, change: (v: string)=>void) { const s = document.createElement('select'); for (const v of values) s.add(new Option(v,v)); s.value=current; s.onchange=()=>change(s.value); field(parent,name,s); return s; }
  private render() {
    this.fields.replaceChildren(); const c=this.draft;
    const filters=document.createElement('div');filters.className='ticker-filter-strip';this.fields.append(filters);
    this.input(filters,'Minimum displayed size','displayMinimum',c.displayMinimum,'number',v=>c.displayMinimum=v);
    this.select(filters,'Display unit',['BTC','USDT'],c.displayUnit,v=>c.displayUnit=v as TickerUnit);
    this.select(filters,'Aggressor side',['both','buy','sell','unknown'],c.side,v=>c.side=v as TickerConfig['side']);
    this.input(filters,'Mute this ticker','muted',c.muted,'checkbox',v=>c.muted=v);
    const hint=document.createElement('p'); hint.className='footprint-settings-hint'; hint.textContent='Display filters affect rows only. Unknown side shows ?. Reported prints may aggregate executions.'; this.fields.append(hint);
    const columns=document.createElement('fieldset');columns.className='ticker-column-options';const legend=document.createElement('legend');legend.textContent='Display columns';columns.append(legend);
    const time=this.input(columns,'Time UTC (required)','time',true,'checkbox');time.disabled=true;
    for(const col of TICKER_COLUMNS)this.input(columns,col.label+' column',col.id,c.columns.includes(col.id),'checkbox',enabled=>{c.columns=TICKER_COLUMNS.filter(item=>item.id===col.id?enabled:c.columns.includes(item.id)).map(item=>item.id);});
    this.fields.append(columns);
    const bars=document.createElement('fieldset');bars.className='ticker-histogram-options';const barsTitle=document.createElement('legend');barsTitle.textContent='Background volume bars';bars.append(barsTitle);
    this.input(bars,'Show volume bars','histogram',c.histogram,'checkbox',v=>c.histogram=v);
    const window=this.input(bars,'Scale window (seconds)','histogramSeconds',c.histogramSeconds,'number',v=>c.histogramSeconds=v);window.min='5';window.max='300';window.step='1';
    const opacity=this.input(bars,'Bar opacity (%)','histogramOpacity',c.histogramOpacity*100,'number',v=>c.histogramOpacity=v/100);opacity.max='60';opacity.step='1';
    const barHint=document.createElement('small');barHint.textContent='Sell bars enter from left; buy bars from right. Shared linear maximum from all selected-market prints in the window, up to 500 retained; follows BTC/USDT filter unit. Pause freezes the scale.';bars.append(barHint);this.fields.append(bars);
    this.scope=button(`Tier scope: ${c.scope.map(marketName).join(' · ') || 'none'}`,()=>this.picker.open(c.scope,{multiple:true,capability:'executions',apply:ids=>{c.scope=ids;this.scope.textContent=`Tier scope: ${ids.map(marketName).join(' · ') || 'none'}`;}})); this.scope.className='ticker-scope'; this.fields.append(this.scope);
    const scopeHint=document.createElement('small'); scopeHint.textContent='Ladder scope intersects ticker markets. Adding a market does not change this scope.'; this.fields.append(scopeHint);
    const heading=document.createElement('div');heading.className='ticker-tier-heading';const title=document.createElement('h3');title.textContent='Size tiers';heading.append(title);
    this.ladderUnit=c.tiers[0].unit;
    this.select(heading,'Ladder unit',['USDT','BTC'],this.ladderUnit,v=>{this.ladderUnit=v as TickerUnit;for(const t of c.tiers)t.unit=this.ladderUnit;});
    this.addTier=button('+ Add tier',()=>{if(c.tiers.length>=12)return;c.tiers.push({...defaultTiers()[0],id:crypto.randomUUID(),name:'New tier',minimum:Math.max(0,...c.tiers.map(t=>t.minimum))+1,unit:this.ladderUnit});this.renderTiers();this.tiers.querySelector<HTMLInputElement>('tbody tr:last-child input[data-key=name]')?.focus();});heading.append(this.addTier);this.fields.append(heading);
    this.tiers=document.createElement('div'); this.tiers.className='ticker-tiers'; this.fields.append(this.tiers); this.renderTiers();
    const rule=document.createElement('small');rule.className='ticker-tier-rule';rule.textContent='Highest matching minimum wins · thresholds are inclusive · Apply saves changes';this.fields.append(rule,this.preview);
  }
  private renderTiers() {
    this.tiers.replaceChildren();if(this.addTier)this.addTier.disabled=this.draft.tiers.length>=12;
    const table=document.createElement('table');table.className='ticker-tier-table';table.setAttribute('aria-label','Size tiers');
    const head=document.createElement('thead'),header=document.createElement('tr');
    for(const name of ['Tier','Minimum ≥','Buy / Sell','Style','Sound','Vol %','Toast','Actions']){const th=document.createElement('th');th.scope='col';th.textContent=name;header.append(th);}head.append(header);table.append(head);
    const body=document.createElement('tbody');table.append(body);
    for(const tier of this.draft.tiers){
      const row=document.createElement('tr');row.dataset.tierId=tier.id;
      const cell=()=>{const td=document.createElement('td');row.append(td);return td;};
      this.input(cell(),'Tier name','name',tier.name,'text',v=>tier.name=v);
      this.input(cell(),'Minimum size','minimum',tier.minimum,'number',v=>tier.minimum=v);
      const colours=cell();colours.className='tier-colours';
      this.input(colours,'Buy colour','buyColor',tier.buyColor,'color',v=>tier.buyColor=v).title='Buy colour';
      this.input(colours,'Sell colour','sellColor',tier.sellColor,'color',v=>tier.sellColor=v).title='Sell colour';
      const style=cell();style.className='tier-style';
      const toggle=(key:'bold'|'pulse',name:string,glyph:string)=>{const input=this.input(style,name,key,tier[key],'checkbox',v=>tier[key]=v);input.setAttribute('aria-label',name);const label=input.parentElement!;label.classList.add('tier-toggle');label.title=name;const icon=document.createElement('b');icon.textContent=glyph;icon.setAttribute('aria-hidden','true');label.append(icon);};
      toggle('bold','Emphasize text','B');toggle('pulse','Brief pulse','◇');
      this.select(cell(),'Sound',[...SOUNDS],tier.sound,v=>tier.sound=v as Tier['sound']);
      const volume=this.input(cell(),'Sound volume (%)','volume',tier.volume*100,'number',v=>tier.volume=v/100);volume.max='100';volume.step='5';
      this.input(cell(),'Show toast','toast',tier.toast,'checkbox',v=>tier.toast=v);
      const actions=cell();actions.className='tier-actions';
      const test=button('▷',()=>this.test(tier));test.setAttribute('aria-label','Test Tier');test.title='Test tier appearance, sound and toast';
      const remove=button('×',()=>{const index=this.draft.tiers.findIndex(t=>t.id===tier.id);this.draft.tiers=this.draft.tiers.filter(t=>t.id!==tier.id);this.renderTiers();const rows=this.tiers.querySelectorAll<HTMLTableRowElement>('tbody tr');rows[Math.min(index,rows.length-1)]?.querySelector<HTMLInputElement>('input')?.focus();if(!rows.length)this.addTier?.focus();});remove.setAttribute('aria-label','Delete tier');remove.title='Delete tier';actions.append(test,remove);
      for(const control of row.querySelectorAll<HTMLElement>('input,select'))control.title ||= control.closest('label')?.querySelector('span')?.textContent??'';
      body.append(row);
    }
    this.tiers.append(table);
    if(!this.draft.tiers.length){const empty=document.createElement('p');empty.className='ticker-tiers-empty';empty.textContent='No tiers. Add one before applying.';this.tiers.append(empty);}
  }
  private valid() { if(!Number.isInteger(this.draft.histogramSeconds)||this.draft.histogramSeconds<5||this.draft.histogramSeconds>300)throw new Error('Bar scale window must be 5–300 whole seconds.');if(!Number.isFinite(this.draft.histogramOpacity)||this.draft.histogramOpacity<0||this.draft.histogramOpacity>.6)throw new Error('Bar opacity must be 0–60%.'); const tiers=validateTiers(this.draft.tiers); if(!Number.isFinite(this.draft.displayMinimum)||this.draft.displayMinimum<0||this.draft.displayMinimum>1e12)throw new Error('Display minimum must be between zero and 1 trillion.'); return tiers; }
  private commit(){try{this.draft.tiers=this.valid();this.apply(this.draft);this.element.close();}catch(e){this.error.textContent=e instanceof Error?e.message:String(e);}}
  private test(tier: Tier){try{this.valid();this.error.textContent='Test preview only · not a live trade';const quantity=tier.unit==='BTC'?Math.max(tier.minimum,.01):Math.max(tier.minimum,1000)/83000;const record={execution:{venue:'binance' as const,market:'perpetual' as const,nativeSymbol:'BTCUSDT',granularity:'aggregate-trade' as const,executionId:'test',timeMs:Date.now(),eventTimeMs:Date.now(),price:83000,quantity,side:'buy' as const},receivedAt:Date.now(),tier,notify:false};const table=document.createElement('table');table.append(tradeRow(record,true));this.preview.replaceChildren(table);this.notifications.deliver({eventId:crypto.randomUUID(),ruleId:`${this.owner()}:preview`,owner:this.owner(),timeMs:Date.now(),fresh:true,title:`Test: ${tier.name}`,text:tradeText(record),sound:tier.sound,volume:tier.volume,toast:tier.toast},true);}catch(e){this.error.textContent=e instanceof Error?e.message:String(e);}}
  dispose(){this.picker.dispose();if(this.element.open)this.element.close();this.element.remove();}
}

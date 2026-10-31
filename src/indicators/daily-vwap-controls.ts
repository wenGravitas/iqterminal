import { dailyVwapSettings, type DailyVwapSettings } from './daily-vwap';
export class DailyVwapControls {
  readonly dialog = document.createElement('dialog');
  private inputs = new Map<keyof DailyVwapSettings, HTMLInputElement | HTMLSelectElement>();
  private target = '';
  constructor(apply: (id: string, settings: DailyVwapSettings) => void, signal: AbortSignal) {
    this.dialog.className = 'indicator-settings'; this.dialog.setAttribute('aria-label','Daily VWAP settings');
    const form = document.createElement('form'); form.className = 'indicator-settings-form';
    const header = document.createElement('header'), title = document.createElement('h2'), close = document.createElement('button');
    title.textContent = 'Daily VWAP'; close.type = 'button'; close.textContent = 'Close'; header.append(title,close); form.append(header);
    const source = document.createElement('select');
    for (const [value,label] of [['hlc3','HLC3 · typical price'],['hl2','HL2 · midpoint'],['close','Close']]) source.add(new Option(label,value));
    this.inputs.set('source',source);
    for (const key of ['bands','secondDeviation','thirdDeviation','readout','nakedGaps','multiplier','lineColor','bandColor','lineWidth','fillOpacity'] as const) {
      const input = document.createElement('input');
      input.type = ['bands','secondDeviation','thirdDeviation','readout','nakedGaps'].includes(key) ? 'checkbox' : key.endsWith('Color') ? 'color' : 'number';
      if (input.type === 'number') {
        input.required = true; input.min = key === 'fillOpacity' ? '0' : key === 'multiplier' ? '.1' : '1';
        input.max = key === 'fillOpacity' ? '.3' : key === 'multiplier' ? '5' : '3';
        input.step = key === 'fillOpacity' ? '.01' : key === 'multiplier' ? '.1' : '1';
      }
      this.inputs.set(key,input);
    }
    const labels: Record<keyof DailyVwapSettings,string> = {source:'Price source',bands:'Show first deviation zone (±1×)',secondDeviation:'Show second deviation zone (±2×)',thirdDeviation:'Show third deviation zone (±3×)',readout:'Show time above/below readout',nakedGaps:'Show naked previous VWAP gaps',multiplier:'Band multiplier (standard deviations)',lineColor:'VWAP colour',bandColor:'Band colour',lineWidth:'VWAP line width',fillOpacity:'Band fill opacity'};
    for (const [key,input] of this.inputs) { const label=document.createElement('label'); label.className='indicator-setting-field'; input.setAttribute('aria-label',labels[key]); label.append(labels[key],input); form.append(label); }
    const help=document.createElement('p'); help.className='dialog-status';
    help.textContent='Resets at 00:00 UTC. Uses intraday candles, not individual executions. Deviation zones use volume-weighted population standard deviation of the selected candle price. The readout compares each candle close with its contemporaneous developing VWAP and weights only observed candle time; equal closes are neutral, missing intervals are excluded, and the forming candle is capped at elapsed time. Naked gaps extend untouched previous daily closing VWAPs to the price axis until touched. Loaded history can be partial; changing timeframe can change these candle-based approximations.';
    const footer=document.createElement('footer'), cancel=document.createElement('button'), save=document.createElement('button');
    cancel.type='button'; cancel.textContent='Cancel'; save.type='submit'; save.textContent='Apply'; save.className='primary';
    footer.append(cancel,save); form.append(help,footer); this.dialog.append(form);
    const options={signal}; close.addEventListener('click',()=>this.dialog.close(),options); cancel.addEventListener('click',()=>this.dialog.close(),options);
    this.dialog.addEventListener('click',event=>{if(event.target===this.dialog)this.dialog.close();},options);
    form.addEventListener('submit',event=>{
      event.preventDefault(); if(!form.reportValidity())return;
      const values=Object.fromEntries([...this.inputs].map(([key,input])=>[key,input instanceof HTMLInputElement ? input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value:input.value]));
      apply(this.target,dailyVwapSettings(values)); this.dialog.close();
    },options);
  }
  open(id:string, settings:DailyVwapSettings) {
    this.target=id;
    for(const [key,input]of this.inputs) { if(input instanceof HTMLInputElement&&input.type==='checkbox')input.checked=settings[key]===true;else input.value=String(settings[key]); }
    if(!this.dialog.open)this.dialog.showModal();
  }
}

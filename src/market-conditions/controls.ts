import { conditionsSettings, DEFAULT_CONDITIONS, EVENTS, type ConditionsSettings, type AlertEvent } from './settings';
import { intervals } from '../feed/protocol';
type Key=keyof ConditionsSettings;
const groups:Record<string,Key[]>={
  General:['mode','component','source','timeframes'],
  Volatility:['atrPeriod','atrLookback','bbwPeriod','bbwMultiplier','bbwLookback','compressionAtr','compressionBbw','extreme','expansionWindow','exitLookback','regimeConfirmation','regimeHysteresis','hvEnabled','hvPeriods'],
  Tradeability:['erPeriod','chopPeriod','efficiencyWeight','volatilityWeight','choppinessWeight','bands','scoreConfirmation','scoreHysteresis','suitabilityLow','suitabilityGood','suitabilityHigh','suitabilityExtreme','minVolatility','lowVolatilityCap','minEfficiency','lowEfficiencyCap','warningPercentile'],
  Display:['density','plotAtr','plotBbw','plotEr','plotChop','plotHv','referenceLines','shading','scoreColor','atrColor','bbwColor','erColor','chopColor','hvColor','compressionColor','normalColor','expandingColor','extremeColor','deadColor','choppyColor','developingColor','tradeableColor','strongColor'],
  Alerts:['alertEvents','alertAbove','alertBelow','combinedThreshold','alertConfirmation','alertHysteresis','alertSound'],
};
const options:Partial<Record<Key,string[]>>={mode:['compact','detailed','dashboard'],component:['both','volatility','tradeability'],source:['chart','binance:spot','binance:perpetual','hyperliquid:perpetual'],density:['compact','detailed']};
export const settingLabel=(key:string)=>key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()).replace(/\bAtr\b/g,'ATR').replace(/\bBbw\b/g,'BBW').replace(/\bEr\b/g,'ER').replace(/\bHv\b/g,'HV');
export class ConditionsControls {
  readonly dialog=document.createElement('dialog');private fields=new Map<Key,HTMLInputElement|HTMLSelectElement>();private current=conditionsSettings({});private eventInputs=new Map<AlertEvent,HTMLInputElement>();
  constructor(private change:(settings:ConditionsSettings)=>void){
    this.dialog.className='indicator-settings market-conditions-settings';this.dialog.setAttribute('aria-label','Market Conditions settings');
    const form=document.createElement('form');form.className='indicator-settings-form';
    const header=document.createElement('header'),title=document.createElement('h2');title.textContent='Market Conditions';header.append(title);
    const content=document.createElement('div');content.className='indicator-settings-fields';
    const help=document.createElement('p');help.textContent='Completed OHLC candles · heuristic conditions, not a buy/sell signal. Source follows the chart unless overridden. STRONG does not mean safe to chase.';content.append(help);
    for(const [name,keys] of Object.entries(groups)){
      const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=name;group.append(legend);
      for(const key of keys){
        if(key==='alertEvents'){
          const labels:Record<AlertEvent,string>={'compression-exit':'Volatility exits compression',expansion:'Volatility enters expansion',extreme:'Volatility enters extreme','score-above':'Tradeability crosses above threshold','score-below':'Tradeability crosses below threshold',classification:'Tradeability classification changes',combined:'Expansion with sufficient tradeability'};
          for(const event of EVENTS){const label=document.createElement('label');label.className='indicator-setting-field';const text=document.createElement('span');text.textContent=labels[event];const input=document.createElement('input');input.type='checkbox';input.setAttribute('aria-label',labels[event]);label.append(text,input);group.append(label);this.eventInputs.set(event,input);}continue;
        }
        const field=document.createElement('label');field.className='indicator-setting-field';const label=document.createElement('span');label.textContent=settingLabel(key);
        const input=options[key]?document.createElement('select'):document.createElement('input');input.setAttribute('aria-label',settingLabel(key));
        if(input instanceof HTMLSelectElement)for(const value of options[key]!)input.add(new Option(value==='dashboard'?'Multi-Timeframe Dashboard':value,value));
        else {const d=DEFAULT_CONDITIONS[key];input.type=typeof d==='boolean'?'checkbox':typeof d==='number'?'number':key.endsWith('Color')?'color':'text';if(input.type==='number')input.step='any';}
        if(key==='timeframes')input.title=`Comma-separated, in display order: ${intervals.join(', ')}. Reorder this list to sort rows.`;
        if(key==='plotHv')input.title='Enable HV in Volatility settings first; plots annualized HV on its own left axis.';
        if(key==='hvPeriods')input.title='Up to three return periods; annualized HV uses its own axis or tooltips, never the 0–100 axis.';
        if(key==='atrLookback'||key==='bbwLookback')input.title='20–750 previous completed observations; waiting for full history is required.';
        field.append(label,input);group.append(field);this.fields.set(key,input);
      }content.append(group);
    }
    const footer=document.createElement('footer'),cancel=document.createElement('button'),apply=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>this.dialog.close();apply.type='submit';apply.textContent='Apply';footer.append(cancel,apply);form.append(header,content,footer);this.dialog.append(form);
    form.onsubmit=e=>{e.preventDefault();const raw:Record<string,unknown>={...this.current};for(const [key,input] of this.fields){const d=DEFAULT_CONDITIONS[key];raw[key]=input instanceof HTMLInputElement&&input.type==='checkbox'?input.checked:typeof d==='number'?Number(input.value):Array.isArray(d)?input.value.split(',').map(x=>x.trim()).filter(Boolean).map(v=>key==='timeframes'||key==='alertEvents'?v:Number(v)):input.value;}raw.alertEvents=[...this.eventInputs].filter(([,input])=>input.checked).map(([event])=>event);this.change(conditionsSettings(raw));this.dialog.close();};
  }
  open(settings:ConditionsSettings){this.current=settings;for(const [event,input]of this.eventInputs)input.checked=settings.alertEvents.includes(event);for(const [key,input] of this.fields){const value=settings[key];if(input instanceof HTMLInputElement&&input.type==='checkbox')input.checked=value===true;else input.value=Array.isArray(value)?value.join(', '):String(value);}this.dialog.showModal();}
  dispose(){if(this.dialog.open)this.dialog.close();this.dialog.remove();}
}

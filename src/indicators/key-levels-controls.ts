import { keyLevelSettings, type KeyLevelSettings } from './key-levels';

export class KeyLevelsControls {
  readonly dialog = document.createElement('dialog');
  private inputs: Record<keyof KeyLevelSettings, HTMLInputElement> = {
    previousHigh: document.createElement('input'), previousLow: document.createElement('input'), todayOpen: document.createElement('input'),
  };
  private target = '';
  constructor(private apply: (id: string, settings: KeyLevelSettings) => void, signal: AbortSignal) {
    this.dialog.className = 'indicator-settings'; this.dialog.setAttribute('aria-label','UTC Key Levels settings');
    const form=document.createElement('form');form.className='indicator-settings-form';form.addEventListener('submit',e=>{e.preventDefault();this.apply(this.target,keyLevelSettings(Object.fromEntries(Object.entries(this.inputs).map(([key,input])=>[key,input.checked]))));this.dialog.close();},{signal});
    const header=document.createElement('header'),title=document.createElement('h2');title.textContent='UTC Key Levels';header.append(title);
    const fields=document.createElement('div');fields.className='indicator-settings-fields';
    for(const [key,label] of [['previousHigh','Previous day high (PDH)'],['previousLow','Previous day low (PDL)'],['todayOpen','Today open (DO)']] as const){const input=this.inputs[key];input.type='checkbox';const row=document.createElement('label');row.className='indicator-setting-field';const text=document.createElement('span');text.textContent=label;row.append(text,input);fields.append(row);}
    const footer=document.createElement('footer'),cancel=document.createElement('button'),save=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>this.dialog.close();save.type='submit';save.textContent='Apply';footer.append(cancel,save);form.append(header,fields,footer);this.dialog.append(form);document.body.append(this.dialog);
  }
  open(id:string, settings:KeyLevelSettings){this.target=id;const value=keyLevelSettings(settings);for(const key of Object.keys(this.inputs) as (keyof KeyLevelSettings)[])this.inputs[key].checked=value[key];this.dialog.showModal();}
  dispose(){if(this.dialog.open)this.dialog.close();this.dialog.remove();}
}

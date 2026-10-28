import {cvdSettings,CVD_STEP,type CvdSettings}from '../feed/cvd';
import {CURRENCY_EVENT,syncCurrencyControl}from '../currency-display';
export class CvdControls {
  readonly dialog=document.createElement('dialog');private settings!:CvdSettings;
  private anchor=document.createElement('select');private custom=document.createElement('input');private unit=document.createElement('select');
  private colors=document.createElement('div');private width=document.createElement('input');private help=document.createElement('p');
  constructor(private apply:(settings:CvdSettings)=>void,signal:AbortSignal){
    this.dialog.className='indicator-settings';this.dialog.setAttribute('aria-label','Multi-Venue CVD settings');
    const form=document.createElement('form');form.className='indicator-settings-form';
    const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');
    title.textContent='Multi-Venue CVD';close.type='button';close.textContent='Close';header.append(title,close);form.append(header);
    for(const [value,label]of [['daily','Daily · 00:00 UTC'],['weekly','Weekly · Monday 00:00 UTC'],['continuous','Continuous · retained origin'],['custom','Custom UTC anchor']])this.anchor.add(new Option(label,value));
    this.custom.type='datetime-local';this.custom.step='1';this.unit.add(new Option('BTC','btc'));this.unit.add(new Option('USDT','usdt'));this.width.type='number';this.width.min='2';this.width.max='4';this.width.step='1';this.width.required=true;
    const field=(label:string,control:HTMLElement)=>{const row=document.createElement('label');row.className='indicator-setting-field';control.setAttribute('aria-label',label);row.append(label,control);form.append(row);};
    field('Reset mode',this.anchor);field('Custom anchor (UTC)',this.custom);field('CVD display unit',this.unit);field('Total line width',this.width);
    this.help.className='dialog-status';this.colors.className='cvd-color-settings';form.append(this.colors,this.help);
    const footer=document.createElement('footer'),cancel=document.createElement('button'),save=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';save.type='submit';save.textContent='Apply';footer.append(cancel,save);form.append(footer);this.dialog.append(form);
    const options={signal};close.addEventListener('click',()=>this.dialog.close(),options);cancel.addEventListener('click',()=>this.dialog.close(),options);
    this.dialog.addEventListener('click',event=>{if(event.target===this.dialog)this.dialog.close();},options);
    this.anchor.addEventListener('change',()=>this.sync(),options);
    this.custom.addEventListener('input',()=>this.sync(),options);
    window.addEventListener(CURRENCY_EVENT,()=>syncCurrencyControl(this.unit,this.settings?.units??'btc'),options);
    form.addEventListener('submit',event=>{
      event.preventDefault();if(!form.reportValidity())return;
      const custom=this.custom.value?Date.parse(this.custom.value+'Z'):this.settings.custom;if(!Number.isFinite(custom))return;
      const colors={...this.settings.colors};for(const input of this.colors.querySelectorAll<HTMLInputElement>('input'))if(input.value!==input.dataset.initial)colors[input.dataset.key!]=input.value;
      this.apply(cvdSettings({...this.settings,anchor:this.anchor.value,custom,units:this.unit.disabled?this.settings.units:this.unit.value,colors,totalWidth:Number(this.width.value)}));this.dialog.close();
    },options);
  }
  private sync(){this.custom.disabled=this.anchor.value!=='custom';this.help.textContent=`All lines use the same anchor. Custom anchors round forward to the next supported minute; pre-anchor flow is excluded. Continuous origin: ${new Date(this.settings.origin).toISOString()}. Effective custom boundary: ${new Date(Math.ceil((Date.parse(this.custom.value+'Z')||this.settings.custom)/CVD_STEP)*CVD_STEP).toISOString()}. No source data before retained coverage is assumed. Quote uses signed executed notional, not CVD × current price.`;}
  open(settings:CvdSettings,lines:{id:string;name:string;color:string}[]){
    this.settings=settings;this.anchor.value=settings.anchor;this.custom.value=new Date(settings.custom).toISOString().slice(0,19);this.width.value=String(settings.totalWidth);
    syncCurrencyControl(this.unit,settings.units);this.colors.replaceChildren();
    for(const line of lines){const label=document.createElement('label');label.className='indicator-setting-field';const input=document.createElement('input');input.type='color';input.dataset.key=line.id;input.value=/^#[\da-f]{6}$/i.test(line.color)?line.color:'#92c5cc';input.dataset.initial=input.value;input.setAttribute('aria-label',`${line.name} colour`);label.append(line.name,input);this.colors.append(label);}
    this.sync();if(!this.dialog.open)this.dialog.showModal();
  }
  dispose(){if(this.dialog.open)this.dialog.close();this.dialog.remove();}
}

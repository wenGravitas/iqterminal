import { MarketPicker } from '../market-picker';
import {button,field} from '../ticker/ui';
import {SOUNDS,validateTiers,type Tier} from '../ticker/model';
import {liquidationSettings,LIQUIDATION_COLUMNS,defaultLiquidationTiers,type LiquidationSettings} from './settings';
export class LiquidationControls {
 readonly dialog=document.createElement('dialog');private form=document.createElement('form');private fields=document.createElement('div');private error=document.createElement('p');private draft=liquidationSettings(undefined);private picker:MarketPicker;
 constructor(parent:HTMLElement,private apply:(settings:LiquidationSettings)=>void,private kind:'ticker'|'chart'){
  this.picker=new MarketPicker(parent);
  this.dialog.className='indicator-settings liquidation-settings';this.dialog.setAttribute('aria-label',kind==='ticker'?'Liquidation Ticker settings':'Liquidations settings');this.form.className='indicator-settings-form';this.fields.className='indicator-settings-fields';
  const header=document.createElement('header'),title=document.createElement('h2');title.textContent=kind==='ticker'?'Liquidation Ticker':'Actual Liquidations';header.append(title,button('Close',()=>this.dialog.close()));
  const footer=document.createElement('footer'),save=document.createElement('button');save.type='submit';save.textContent='Apply';save.className='primary';footer.append(button('Cancel',()=>this.dialog.close()),save);this.error.className='dialog-status';this.error.setAttribute('role','status');
  this.form.append(header,this.fields,this.error,footer);this.dialog.append(this.form);parent.append(this.dialog);
  this.form.onsubmit=e=>{e.preventDefault();try{if(!this.form.reportValidity())return;this.draft.tiers=validateTiers(this.draft.tiers);this.apply(liquidationSettings(this.draft));this.dialog.close();}catch(error){this.error.textContent=String((error as Error).message);}};
 }
 private number(parent:HTMLElement,label:string,value:number,min:number,max:number,apply:(v:number)=>void,step='any'){const i=document.createElement('input');i.type='number';i.required=true;i.min=String(min);i.max=String(max);i.step=step;i.value=String(value);i.oninput=()=>apply(Number(i.value));field(parent,label,i);return i;}
 private toggle(parent:HTMLElement,label:string,value:boolean,apply:(v:boolean)=>void){const i=document.createElement('input');i.type='checkbox';i.checked=value;i.onchange=()=>apply(i.checked);field(parent,label,i);}
 private select(parent:HTMLElement,label:string,value:string,values:readonly string[],apply:(v:string)=>void){const s=document.createElement('select');for(const v of values)s.add(new Option(v,v));s.value=value;s.onchange=()=>apply(s.value);field(parent,label,s);}
 open(settings:LiquidationSettings){this.draft=structuredClone(settings);this.error.textContent='';this.render();this.dialog.showModal();}
 private render(){this.fields.replaceChildren();const s=this.draft;
  const venues=button('Venues: '+(s.venues.join(' + ')||'none'),()=>this.picker.open(s.venues.map(v=>`${v}:perpetual` as const),{multiple:true,capability:'liquidations',apply:ids=>{s.venues=ids.filter(id=>id==='bybit:perpetual'||id==='binance:perpetual').map(id=>id.startsWith('bybit')?'bybit':'binance');venues.textContent='Venues: '+(s.venues.join(' + ')||'none');}}));venues.setAttribute('aria-label','Choose liquidation venues');this.fields.append(venues);
  this.select(this.fields,'Liquidated position side',s.side,['BOTH','LONG','SHORT'],v=>s.side=v as typeof s.side);
  this.number(this.fields,'Minimum displayed liquidation size',s.minimum,0,1e12,v=>s.minimum=v);
  this.select(this.fields,'Liquidation display unit',s.units,['USDT','BTC'],v=>s.units=v as typeof s.units);
  this.toggle(this.fields,'Mute liquidation alerts',s.muted,v=>s.muted=v);
  if(this.kind==='ticker')this.toggle(this.fields,'Show bursts in tape',s.showBursts,v=>s.showBursts=v);
  if(this.kind==='chart'){
   this.toggle(this.fields,'Show venue legend',s.legend,v=>s.legend=v);
   this.toggle(this.fields,'Show liquidations on price chart',s.markers,v=>s.markers=v);
   this.number(this.fields,'Minimum marker notional (USDT)',s.markerMinimum,0,1e12,v=>s.markerMinimum=v);
   this.number(this.fields,'Maximum visible liquidation markers',s.markerDensity,1,200,v=>s.markerDensity=v,'1');
  }else{const columns=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Columns';columns.append(legend);for(const id of LIQUIDATION_COLUMNS)this.toggle(columns,`Show ${id}`,s.columns.includes(id),on=>{s.columns=on?[...s.columns.filter(x=>x!==id),id]:s.columns.filter(x=>x!==id);});this.fields.append(columns);}
  const burst=document.createElement('fieldset'),title=document.createElement('legend');title.textContent='Liquidation bursts · reported USDT notional';burst.append(title);
  this.number(burst,'Burst rolling window (seconds)',s.burst.windowMs/1000,1,300,v=>s.burst.windowMs=v*1000);
  this.number(burst,'Burst minimum aggregate notional (USDT)',s.burst.minimum,0,1e12,v=>s.burst.minimum=v);
  this.number(burst,'Burst minimum event count',s.burst.count,2,4096,v=>s.burst.count=v,'1');
  this.number(burst,'Burst alert cooldown (seconds)',s.burst.cooldownMs/1000,1,3600,v=>s.burst.cooldownMs=v*1000);
  this.toggle(burst,'Enable burst alerts',s.burst.alerts,v=>s.burst.alerts=v);this.select(burst,'Burst sound',s.burst.sound,SOUNDS,v=>s.burst.sound=v as typeof s.burst.sound);
  this.number(burst,'Burst sound volume (%)',s.burst.volume*100,0,100,v=>s.burst.volume=v/100);this.toggle(burst,'Burst toast',s.burst.toast,v=>s.burst.toast=v);this.fields.append(burst);
  if(this.kind==='ticker')this.renderTiers();
  const hint=document.createElement('p');hint.className='dialog-status';hint.textContent='LONG liquidations are red; SHORT liquidations are cyan. Bybit prices are bankruptcy prices. Binance publishes sampled cumulative order snapshots, which may overlap. Aggregates sum reported snapshot values, not unique executed liquidation volume. Alerts require newly received live reports and enabled browser audio. Replay and settings changes stay silent.';this.fields.append(hint);
 }
 private renderTiers(){const holder=document.createElement('fieldset'),title=document.createElement('legend');title.textContent='Size tiers · highest matching threshold';holder.append(title);const s=this.draft;
  for(const tier of s.tiers){const row=document.createElement('fieldset');row.className='liquidation-tier';const label=document.createElement('input');label.value=tier.name;label.maxLength=60;label.required=true;label.oninput=()=>tier.name=label.value;field(row,'Tier name',label);
   this.number(row,'Tier minimum',tier.minimum,0,1e12,v=>tier.minimum=v);this.select(row,'Tier unit',tier.unit,['USDT','BTC'],v=>{for(const t of s.tiers)t.unit=v as Tier['unit'];this.render();});
   for(const [key,name]of [['sellColor','Long liquidation colour'],['buyColor','Short liquidation colour']] as const){const color=document.createElement('input');color.type='color';color.value=tier[key];color.oninput=()=>tier[key]=color.value;field(row,name,color);}
   this.toggle(row,'Bold tier',tier.bold,v=>tier.bold=v);this.toggle(row,'Pulse tier',tier.pulse,v=>tier.pulse=v);this.select(row,'Tier sound',tier.sound,SOUNDS,v=>tier.sound=v as Tier['sound']);
   this.number(row,'Tier sound volume (%)',tier.volume*100,0,100,v=>tier.volume=v/100);this.toggle(row,'Tier toast',tier.toast,v=>tier.toast=v);
   row.append(button('Remove tier',()=>{s.tiers=s.tiers.filter(t=>t.id!==tier.id);this.render();}));holder.append(row);
  }
  const add=button('Add liquidation tier',()=>{if(s.tiers.length>=12)return;s.tiers.push({...defaultLiquidationTiers()[0]!,id:crypto.randomUUID(),name:'New tier',minimum:Math.max(...s.tiers.map(t=>t.minimum),0)+1,unit:s.tiers[0]?.unit??'USDT'});this.render();});add.disabled=s.tiers.length>=12;holder.append(add);this.fields.append(holder);
 }
 dispose(){this.picker.dispose();if(this.dialog.open)this.dialog.close();this.dialog.remove();}
}

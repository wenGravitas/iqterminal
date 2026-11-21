import {venueBadge,venueIconPath} from '../chart/venue-label';
import {exposureSummary} from './chart';
import type {MapCell,MapColumn,MapSettings} from './model';
const formatPrice=(value:number)=>value.toLocaleString('en-US',{maximumFractionDigits:8});
const amount=(value:number)=>value.toLocaleString('en-US',{maximumSignificantDigits:4});
/** Same native card vocabulary as Net Longs/Shorts; scenarios are alternatives,
 * so per-venue amounts use the map's scenario mean rather than raw cell sums. */
export function renderMapTooltip(element:HTMLElement,data:{column:MapColumn;cells:MapCell[];settings:MapSettings;quote:string;low:number;high:number;profile:boolean}) {
 const {column,cells,settings,quote,low,high}=data,unit=settings.units==='BTC'?'BTC':quote;
 const summary=exposureSummary(column,settings,quote,low,high);
 const node=(tag:string,cls:string,text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
 const date=new Date(column.availableAt),stamp=date.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})+', '+date.toISOString().slice(11,19)+' UTC';
 const time=document.createElement('time');time.dateTime=date.toISOString();time.textContent=stamp;
 const header=node('div','positioning-tooltip-header');header.append(time,node('span','positioning-tooltip-muted',data.profile?'Profile snapshot':'Time/price cell'));
 const heading=node('div','positioning-tooltip-heading');heading.append(node('strong','','Liquidation Map'),node('strong','positioning-tooltip-value',`Mean ${summary.mean.toPrecision(3)} ${unit}`));
 const price=node('div','positioning-tooltip-muted',`${formatPrice(low)}–${formatPrice(high)} native price · ${settings.priceWidth===high-low?'price grid':'screen LOD'}`);
 const rows=node('div','positioning-tooltip-sources');
 for(const venue of [...new Set(cells.map(c=>c.venue))]){
  const selected={...settings,venues:[venue]},sourceCells=cells.filter(c=>c.venue===venue),source=(column.sources??[]).find(s=>s.venue===venue);
  const mean=exposureSummary(column,selected,quote,low,high).mean;
  const row=node('div','positioning-tooltip-row'),label=node('span','positioning-tooltip-label positioning-tooltip-venue');
  if(venue==='binance'||venue==='hyperliquid'||venue==='bybit'){
   const icon=document.createElement('img');icon.src=venueIconPath(venue);icon.alt='';icon.width=12;icon.height=12;label.append(icon,document.createTextNode(venueBadge(venue)));
  }else label.textContent=venue==='lighter'?'Lighter':'Coinbase';
  const kinds=[...new Set(sourceCells.map(c=>c.kind==='observed'?'Observed subset':'Model estimate'))];
  const bar=node('span','positioning-tooltip-track'),fill=node('span','positioning-tooltip-fill');fill.style.width=`${summary.mean>0?Math.min(100,mean/summary.mean*100):0}%`;fill.style.backgroundColor='var(--accent)';bar.append(fill);
  const swatch=node('span','positioning-tooltip-swatch');swatch.style.backgroundColor='var(--accent)';
  row.append(swatch,label,bar,node('span','positioning-tooltip-amount',`${amount(mean)} ${unit}`));rows.append(row);
  const longs=exposureSummary(column,{...selected,longs:true,shorts:false},quote,low,high).mean,shorts=exposureSummary(column,{...selected,longs:false,shorts:true},quote,low,high).mean;
  // Respect the same side filters as the map, including hidden sides.
  const detail=node('div','positioning-tooltip-quality',`${kinds.join(' + ')} · ${[...(settings.longs?['long '+amount(longs)]:[]),...(settings.shorts?['short '+amount(shorts)]:[])].join(' / ')} ${unit}`);rows.append(detail);
  if(source){const age=source.asOf?`${Math.max(0,Math.round((Date.now()-source.asOf)/1000))}s old`:'age unavailable';rows.append(node('div','positioning-tooltip-quality',`${source.state} · ${age} · ${source.accounts} accounts · coverage ${source.coverageProxy===null?'unverified':amount(source.coverageProxy*100)+'% proxy'}`));}
  if(source?.mark){const m=source.mark;rows.append(node('div','positioning-tooltip-quality',`Native mark: ${m.kind} · ${Math.max(0,Math.round(((data.profile?Date.now():column.availableAt)-Math.min(m.sourceTime,m.receivedAt))/1000))}s · ${m.sourceTimeQuality}${m.reason?' · '+m.reason:''} · quarantined ${amount(source.quarantinedQuantity??0)} BTC`));}
  rows.append(node('div','positioning-tooltip-quality',[...new Set(sourceCells.map(c=>c.retirementState??'Legacy retirement evidence unavailable'))].join(' · ')));
  const timestampQuality=[...new Set(sourceCells.map(c=>c.sourceTimeQuality).filter(Boolean))];if(timestampQuality.length)rows.append(node('div','positioning-tooltip-quality',`Position timestamp: ${timestampQuality.join(' / ')}${timestampQuality.includes('receipt-proxy')?' (native state age not established)':''}`));
  if(sourceCells.some(c=>c.quoteVerified===false))rows.append(node('div','positioning-tooltip-quality','Native quote denomination unverified'));
 }
 const estimated=cells.some(c=>c.kind==='estimated');
 const range=node('div','positioning-tooltip-total');range.append(node('span','positioning-tooltip-muted',estimated?'Model-scenario range':'Observed exposure'),node('strong','',estimated?`${amount(summary.minimum)}–${amount(summary.maximum)} ${unit}`:`${amount(summary.mean)} ${unit}`));
 const versions=[...new Set(cells.map(c=>`${c.modelVersion} / ${c.riskVersion}`))];
 const footer=node('div','positioning-tooltip-muted positioning-tooltip-status',`Conditional exposure, not confirmed liquidations. ${estimated?'Uncalibrated model scenarios; shared scenario index.':'Observed account subset.'} ${column.validUntil!==undefined?'Recorded interval ends '+new Date(column.validUntil).toISOString()+'. ':''}Snapshot ${Math.max(0,Math.round((Date.now()-column.availableAt)/1000))}s old. Native prices; no FX/basis conversion.`);
 const provenance=node('div','positioning-tooltip-quality',`Model / risk: ${versions.join('; ')} · ${column.quality.join(', ')}`);provenance.style.overflowWrap='anywhere';
 element.replaceChildren(header,heading,price,rows,range,footer,provenance);
}

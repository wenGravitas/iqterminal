import type {WatchDefinition} from './types';
export interface ReplayPoint {at:number;price?:number|null;priceTime?:number|null;health:{state:string}}
/** Bounded preview of admitted execution prices, not candles or traded-volume aggregation. */
export function replayGeometry(rows:ReplayPoint[],zone:WatchDefinition,cutoff=Infinity){
  const visible=rows.slice(-500).filter(r=>(r.priceTime??r.at)<=cutoff);
  const known=visible.filter(r=>r.health.state==='ready'&&r.price!=null&&Number.isFinite(r.price));
  const low=Math.min(zone.invalidation,...known.map(r=>r.price!)),high=Math.max(zone.upper,...known.map(r=>r.price!)),padding=Math.max(.1,(high-low)*.1);
  const min=low-padding,max=high+padding,from=visible[0]?.at??0,to=Math.max(from+1,visible.at(-1)?.at??0);
  const y=(p:number)=>10+(max-p)/(max-min)*130,x=(t:number)=>55+(t-from)/(to-from)*425;let path='',connected=false;
  for(const r of visible){if(r.health.state!=='ready'||r.price==null||!Number.isFinite(r.price)){connected=false;continue;}path+=`${connected?'L':'M'}${x(r.at).toFixed(2)},${y(r.price).toFixed(2)} `;connected=true;}
  return {path,from,to,lines:[zone.upper,zone.lower,zone.invalidation].map(price=>({price,y:y(price)}))};
}
export function replayPlot(rows:ReplayPoint[],zone:WatchDefinition,cutoff=Infinity){const geometry=replayGeometry(rows,zone,cutoff),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 500 160');svg.setAttribute('role','img');svg.setAttribute('aria-label','Recorded execution price sampled at admitted batches. Gaps are disconnected.');svg.classList.add('watch-replay-plot');
  const labelled:number[]=[];
  for(const line of geometry.lines){const p=document.createElementNS(ns,'path');p.setAttribute('d',`M55,${line.y}H480`);p.setAttribute('stroke','currentColor');p.setAttribute('opacity','.35');p.setAttribute('stroke-dasharray','3 4');svg.append(p);if(labelled.some(y=>Math.abs(y-line.y)<12))continue;labelled.push(line.y);const label=document.createElementNS(ns,'text');label.setAttribute('x','1');label.setAttribute('y',String(line.y+3));label.textContent=line.price.toFixed(1);svg.append(label);}
  const path=document.createElementNS(ns,'path');path.setAttribute('d',geometry.path);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');svg.append(path);return svg;
}

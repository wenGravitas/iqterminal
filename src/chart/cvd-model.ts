import { cvdAnchorAt, cvdValues, cvdSourceLabel, type CvdPoint,type CvdSeries,type CvdSettings } from '../feed/cvd';
export interface CvdLinePoint {time:number;period:number;value:number|null;partial:boolean}
export interface CvdLine {id:string;name:string;points:CvdLinePoint[];filtered:boolean}
export function cvdLowerBound<T>(rows:readonly T[],time:number,get:(row:T)=>number){let l=0,h=rows.length;while(l<h){const m=(l+h)>>>1;if(get(rows[m]!)<time)l=m+1;else h=m;}return l;}
export class CvdPlotModel {
  readonly sources=new Map<string,CvdSeries>();readonly lines=new Map<string,CvdLine>();
  private first=Infinity;private times:number[]=[];private dirtyTimes=false;private key='';
  update(series:CvdSeries){
    const previous=this.sources.get(series.source);
    if(series.snapshot||!previous){this.sources.set(series.source,{...series,points:[...series.points]});this.first=-Infinity;this.dirtyTimes=true;return;}
    const rows=previous.points;
    for(const p of series.points){const i=cvdLowerBound(rows,p.time,p=>p.time);if(rows[i]?.time===p.time)rows[i]=p;else{rows.splice(i,0,p);this.dirtyTimes=true;}this.first=Math.min(this.first,p.time);}
    const start=cvdLowerBound(rows,series.removeBefore,p=>p.time);if(start){rows.splice(0,start);this.dirtyTimes=true;this.first=-Infinity;}
    if(previous.status!==series.status)this.first=-Infinity;
    this.sources.set(series.source,{...series,points:rows});
  }
  derive(settings:CvdSettings,unit:'btc'|'usdt'){
    const key=JSON.stringify([settings.sources,settings.groups,settings.mode,settings.anchor,settings.origin,settings.custom,unit]);
    if(key!==this.key){this.first=-Infinity;this.key=key;this.dirtyTimes=true;}
    if(this.first===Infinity)return;
    if(this.dirtyTimes){this.times=[...new Set(settings.sources.flatMap(source=>this.sources.get(source)?.points.map(p=>p.time)??[]))].sort((a,b)=>a-b);this.dirtyTimes=false;}
    const wanted=['total',...(settings.mode==='venues'?settings.sources:settings.groups.map(g=>g.id))];
    for(const id of this.lines.keys())if(!wanted.includes(id))this.lines.delete(id);
    for(const id of wanted){
      let line=this.lines.get(id);if(!line){line={id,name:id==='total'?'Total':settings.groups.find(g=>g.id===id)?.name??cvdSourceLabel(id),points:[],filtered:false};this.lines.set(id,line);}
      line.points.splice(cvdLowerBound(line.points,this.first,p=>p.time));
    }
    const start=cvdLowerBound(this.times,this.first,t=>t);
    for(let index=start;index<this.times.length;index++){
      const time=this.times[index]!,period=cvdAnchorAt(time-1,settings);
      const values=new Map<string,{value:number;observed:boolean;partial:boolean}>();
      for(const source of settings.sources){
        const points=this.sources.get(source)?.points??[];let at=cvdLowerBound(points,time,p=>p.time);
        if(points[at]?.time!==time)at--;
        const p=points[at];if(!p||p.period!==period||!p.available)continue;
        values.set(source,{value:unit==='btc'?p.base:p.quote,observed:p.observed&&p.time===time,partial:p.partial});
        if(settings.mode==='venues')this.lines.get(source)?.points.push({time,period,value:p.observed&&p.time===time?(unit==='btc'?p.base:p.quote):null,partial:p.partial});
      }
      const result=cvdValues(settings.sources,values,settings.groups);
      const stale=settings.sources.some(id=>{const source=this.sources.get(id);return !source||source.status!=='live'&&time>source.coverage.to;});
      this.lines.get('total')!.points.push({time,period,value:result.total.value,partial:result.total.partial||stale});
      if(settings.mode==='aggregations')for(const group of result.groups){
        const line=this.lines.get(group.id)!;line.name=group.name;line.filtered=group.filtered;
        line.points.push({time,period,value:group.value,partial:group.partial||stale});
      }
    }
    this.first=Infinity;
  }
  value(id:string,time?:number){const points=this.lines.get(id)?.points??[];if(time===undefined)return points.at(-1);
    let at=cvdLowerBound(points,time,p=>p.time);if(points[at]?.time!==time)at--;return points[at];}
}
export function compactCvd(value:number|null|undefined){if(value==null)return '—';const abs=Math.abs(value);const sign=value<0?'−':value>0?'+':'';
  const rounded=Number(abs.toPrecision(3));
  for(const [size,suffix]of [[1e9,'B'],[1e6,'M'],[1e3,'K']]as const)if(rounded>=size)return sign+Number((abs/size).toPrecision(3))+suffix;
  return sign+Number(abs.toPrecision(3));
}

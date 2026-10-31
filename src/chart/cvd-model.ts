import { cvdAnchorAt, cvdValues, cvdSourceLabel, CVD_STEP, type CvdPoint,type CvdSeries,type CvdSettings } from '../feed/cvd';
import type { Candle } from '../feed/protocol';
export interface CvdLinePoint {time:number;period:number;value:number|null;partial:boolean}
export interface CvdLine {id:string;name:string;points:CvdLinePoint[];filtered:boolean}
export interface CvdNumericProjection {
  plotKey:string;title:string;unit:'BTC'|'USDT';sourceScope:string;values:(number|null)[];
  resets:{fromTime:number;reason:string}[];quality:'complete'|'partial'|'stale'|'unavailable';available:boolean;
}
export function cvdLowerBound<T>(rows:readonly T[],time:number,get:(row:T)=>number){let l=0,h=rows.length;while(l<h){const m=(l+h)>>>1;if(get(rows[m]!)<time)l=m+1;else h=m;}return l;}
function cvdGroupKey(id:string){let hash=2166136261;for(const char of id)hash=Math.imul(hash^char.charCodeAt(0),16777619);return `${id.replace(/[^A-Za-z0-9]/g,'').slice(0,16)||'Group'}${(hash>>>0).toString(36)}`;}
export function cvdNumericPlotKey(id:string,unit:'BTC'|'USDT'){
  const suffix=unit==='BTC'?'Btc':'Usdt';
  if(id==='total')return `cvdTotal${suffix}`;
  if(id.startsWith('group:'))return `cvdGroup${cvdGroupKey(id.slice(6))}${suffix}`;
  const venue=id==='binance:spot'?'BinanceSpot':id==='binance:perpetual'?'BinancePerpetual':id==='bybit:perpetual'?'BybitPerpetual':`Source${cvdGroupKey(id)}`;
  return `cvdVenue${venue}${suffix}`;
}
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

  /** Stable native numeric outputs, projected only onto the host candle timeline. */
  projectNumericOutputs(settings:CvdSettings,candles:readonly Candle[],intervalMs:number,now:number):CvdNumericProjection[]{
    if(!Number.isSafeInteger(intervalMs)||intervalMs<=0)return [];
    const host=candles.slice(-5_000);
    const configured=[{id:'total',name:'Total',markets:[...settings.sources],scope:'cvd:included-sources'},
      ...settings.sources.map(id=>({id,name:cvdSourceLabel(id),markets:[id],scope:`cvd:venue:${id}`})),
      ...settings.groups.map(group=>({id:`group:${group.id}`,name:group.name,markets:group.markets,scope:`cvd:group:${group.id}`}))];
    const projections:CvdNumericProjection[]=[];
    for(const unit of ['BTC','USDT'] as const)for(const line of configured){
      const values:(number|null)[]=Array(host.length).fill(null),resets:{fromTime:number;reason:string}[]=[];
      let previousPeriod:number|undefined,previousPartial=false,partial=false,stale=false,available=false;
      for(let index=0;index<host.length;index++){
        const candle=host[index]!,end=candle.t+intervalMs;
        const samples=new Map<string,{value:number;period:number;partial:boolean;stale:boolean}>();
        for(const source of settings.sources){
          const series=this.sources.get(source),sample=series&&projectSourcePoint(series,candle,end,now,settings,unit);
          if(sample)samples.set(source,sample);
          if(series?.status==='stale')stale=true;
        }
        let value:number|null=null,isPartial=false,period=cvdAnchorAt((candle.closed?end:Math.min(end,now))-1,settings);
        if(line.id==='total'||line.id.startsWith('group:')){
          const ids=line.markets.filter(id=>settings.sources.includes(id as CvdSettings['sources'][number]));
          let sum=0,hasValue=false;
          for(const id of ids){const sample=samples.get(id);if(!sample){isPartial=true;continue;}
            sum+=sample.value;hasValue=true;isPartial||=sample.partial;period=sample.period;stale||=sample.stale;}
          if(ids.length!==line.markets.length)isPartial=true;
          if(hasValue)value=sum;
          if(line.id==='total'&&!line.markets.length)isPartial=true;
        }else{
          const sample=samples.get(line.id);
          if(sample){value=sample.value;period=sample.period;isPartial=sample.partial;stale||=sample.stale;}
          else isPartial=true;
        }
        if(index>0&&candle.t-host[index-1]!.t>intervalMs){isPartial=true;pushReset(resets,candle.t,'Host candle timestamp gap');}
        if(previousPeriod!==undefined&&period!==previousPeriod)pushReset(resets,candle.t,`${settings.anchor} UTC CVD reset`);
        if(isPartial&&!previousPartial)pushReset(resets,candle.t,'Incomplete or interrupted signed execution coverage');
        if(value!==null&&Number.isFinite(value)){values[index]=value;available=true;}else values[index]=null;
        partial||=isPartial;previousPeriod=period;previousPartial=isPartial;
      }
      const configuredHere=line.id==='total'||line.id.startsWith('group:')
        ? line.markets.some(id=>settings.sources.includes(id as CvdSettings['sources'][number]))
        : settings.sources.includes(line.id as CvdSettings['sources'][number]);
      projections.push({plotKey:cvdNumericPlotKey(line.id,unit),title:`CVD · ${line.name} (${unit})`,unit,sourceScope:line.scope,
        values,resets,available:available&&configuredHere,
        quality:!available||!configuredHere?'unavailable':stale?'stale':partial?'partial':'complete'});
    }
    return projections;
  }

  clear(){this.sources.clear();this.lines.clear();this.first=-Infinity;this.times=[];this.dirtyTimes=true;this.key='';}
}

function projectSourcePoint(series:CvdSeries,candle:Candle,candleEnd:number,now:number,settings:CvdSettings,unit:'BTC'|'USDT'){
  if(!candle.closed&&now<candle.t)return undefined;
  const end=candle.closed?candleEnd:Math.min(candleEnd,now);
  const upper=cvdLowerBound(series.points,end,p=>p.time);
  let at=upper;if(series.points[at]?.time!==end)at--;
  let point=series.points[at];
  // A live, not-yet-closed source minute contains an as-of-now cumulative value.
  // Its bar endpoint lies in the future, so project it only into the current host candle.
  const next=series.points[upper];
  if(!candle.closed&&next&&next.time<=candleEnd&&next.time>end
    &&next.time-CVD_STEP<=end&&series.status==='live'&&series.asOf>=next.time-CVD_STEP)point=next;
  if(!point||!point.available)return undefined;
  const period=cvdAnchorAt(end-1,settings);if(point.period!==period)return undefined;
  const from=point.time<=end?point.time:candle.t;
  const gap=series.coverage.gaps.some(item=>item.from<end&&item.to>from);
  const coverageConfirmed=series.status==='live'?series.asOf>=end:series.coverage.to>=end;
  const partial=point.partial||!point.observed||gap||!coverageConfirmed;
  return {value:unit==='BTC'?point.base:point.quote,period,partial,stale:series.status==='stale'};
}

function pushReset(resets:{fromTime:number;reason:string}[],fromTime:number,reason:string){
  if(resets.at(-1)?.fromTime===fromTime)return;
  resets.push({fromTime,reason});if(resets.length>128)resets.shift();
}
export function compactCvd(value:number|null|undefined){if(value==null)return '—';const abs=Math.abs(value);const sign=value<0?'−':value>0?'+':'';
  const rounded=Number(abs.toPrecision(3));
  for(const [size,suffix]of [[1e9,'B'],[1e6,'M'],[1e3,'K']]as const)if(rounded>=size)return sign+Number((abs/size).toPrecision(3))+suffix;
  return sign+Number(abs.toPrecision(3));
}

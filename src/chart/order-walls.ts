import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { orderWallValuePointAt, type OrderWallHit, type OrderWallPatch, type OrderWallSegment, type OrderWallsSettings, type OrderWallStatus } from '../feed/order-walls';

interface WallDrawable { key:string; segment:OrderWallSegment; runIndex:number; from:number; to:number; percentile:number|null; x:number; right:number; y:number; low:number; high:number }

/** The chart data layer preserves sub-candle event times as fractional logical indices. */
export function wallTimestampToLogical(timeMs:number,timeToIndexFloat:(seconds:number)=>number):number|null {
  if(!Number.isFinite(timeMs))return null;
  const logical=timeToIndexFloat(timeMs/1000);
  return Number.isFinite(logical)?logical:null;
}

export class OrderWallsPrimitive implements IPrimitive {
  private host?:PrimitiveHost;
  private settings:OrderWallsSettings;
  private intervalMs:number;
  private status:OrderWallStatus={state:'loading'};
  private segments=new Map<string,OrderWallSegment>();
  private drawable=new Map<string,WallDrawable>();
  private drawableKeys=new Map<string,string[]>();
  private version=0;
  private transformKey='';
  private dirty=new Set<string>();
  private tailDirty=new Map<string,number>();
  private timeAtX?:(x:number)=>number;
  readonly stats={draws:0,rebuilds:0,patchProjects:0,segments:0,visible:0,bytes:0,renderMs:0,maxRenderMs:0};
  private durations:number[]=[];

  constructor(settings:OrderWallsSettings,intervalMs:number){this.settings={...settings};this.intervalMs=intervalMs;}
  zOrder(){return 'normal' as const;}
  autoscaleInfo(){return null;}
  attached(host:PrimitiveHost){this.host=host;}
  detached(){this.host=undefined;this.segments.clear();this.drawable.clear();this.drawableKeys.clear();this.dirty.clear();this.tailDirty.clear();this.timeAtX=undefined;this.stats.bytes=0;}
  setSettings(settings:OrderWallsSettings){this.settings={...settings};this.version++;this.host?.requestUpdate();}
  setInterval(intervalMs:number){if(this.intervalMs!==intervalMs){this.intervalMs=intervalMs;this.transformKey='';this.host?.requestUpdate();}}
  setStatus(status:OrderWallStatus){
    const prior=this.status.lastConfirmedAt;this.status={...status};
    if(prior!==status.lastConfirmedAt)for(const[id,segment]of this.segments)if(segment.end===null)this.markTail(id,Math.max(0,segment.valueRuns.length-1));
    this.host?.requestUpdate();
  }
  setSnapshot(segments:OrderWallSegment[],status:OrderWallStatus){
    this.status={...status};this.segments.clear();this.drawable.clear();this.drawableKeys.clear();this.tailDirty.clear();
    for(const segment of segments)if(validSegment(segment)&&!this.beforeRetention(segment))this.segments.set(segment.id,segment);
    this.dirty=new Set(this.segments.keys());this.version++;this.transformKey='';this.measureBytes();this.host?.requestUpdate();
  }
  patch(patches:OrderWallPatch[],status:OrderWallStatus){
    this.status={...status};
    for(const patch of patches){
      if(!patch.segment||!validSegment(patch.segment)||this.beforeRetention(patch.segment)){
        this.dirty.add(patch.id);this.tailDirty.delete(patch.id);this.segments.delete(patch.id);continue;
      }
      const previous=this.segments.get(patch.id),next=patch.segment;
      this.segments.set(patch.id,next);
      const shifted=Boolean(previous&&(previous.valueRunsTruncated!==next.valueRunsTruncated||
        (previous.valueRuns[0]&&next.valueRuns[0]&&previous.valueRuns[0].at!==next.valueRuns[0].at)));
      if(!previous||shifted||previous.price!==next.price||previous.start!==next.start){this.dirty.add(patch.id);this.tailDirty.delete(patch.id);}
      else this.markTail(patch.id,Math.max(0,previous.valueRuns.length-1));
    }
    this.measureBytes();this.host?.requestUpdate();
  }
  private beforeRetention(segment:OrderWallSegment){return this.status.retentionStart!==undefined&&(segment.end??this.status.lastConfirmedAt??segment.start)<=this.status.retentionStart;}
  private width(){return this.settings.aggregation==='auto'?this.status.resolvedPriceWidth??this.status.tickSize??.1:this.settings.aggregation;}
  private markTail(id:string,index:number){if(this.dirty.has(id))return;this.tailDirty.set(id,Math.min(index,this.tailDirty.get(id)??index));}

  draw(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){
    if(!this.settings.enabled||!this.segments.size)return;
    const started=performance.now(),range=rc.timeScale.visibleRange(),prices=rc.priceScale.priceRange(),dpr=rc.dpr;
    // Primitive hit inputs are plot-local CSS pixels, like indexToX/projected lines.
    // Only drawing coordinates are multiplied by DPR.
    this.timeAtX=x=>rc.dataLayer.indexToTimeFloat(rc.timeScale.xToIndex(x))*1000;
    const key=[this.version,this.intervalMs,range.from,range.to,prices.min,prices.max,rc.plotWidth,rc.plotHeight,dpr,
      rc.dataLayer.length,rc.dataLayer.indexToTime(0),rc.dataLayer.indexToTime(rc.dataLayer.baseIndex),this.width()].join(':');
    if(key!==this.transformKey){this.drawable.clear();this.drawableKeys.clear();this.tailDirty.clear();this.dirty=new Set(this.segments.keys());this.transformKey=key;this.stats.rebuilds++;}
    if(this.dirty.size){
      for(const id of this.dirty){this.removeDrawables(id);const segment=this.segments.get(id);if(segment)this.projectAll(segment,rc);this.stats.patchProjects++;}
      this.dirty.clear();
    }
    if(this.tailDirty.size){for(const[id,index]of this.tailDirty){const segment=this.segments.get(id);if(segment)this.projectTail(segment,index,rc);this.stats.patchProjects++;}this.tailDirty.clear();}
    this.stats.draws++;this.stats.segments=this.segments.size;this.stats.visible=this.drawable.size;
    ctx.save();ctx.beginPath();ctx.rect(0,0,rc.plotWidth*dpr,rc.plotHeight*dpr);ctx.clip();
    ctx.globalAlpha=this.settings.opacity;ctx.lineWidth=this.settings.thicknessPx*dpr;ctx.lineCap='butt';ctx.setLineDash([]);
    let group:{segmentId:string;epoch:string|number;side:'bid'|'ask';color:string;from:number;to:number;x:number;right:number;y:number;low:number;high:number}|undefined;
    const strokeGroup=()=>{
      if(!group)return;
      ctx.strokeStyle=group.color;ctx.beginPath();ctx.moveTo(group.x*dpr,group.y*dpr);ctx.lineTo(group.right*dpr,group.y*dpr);ctx.stroke();
      group=undefined;
    };
    for(const line of this.drawable.values()){
      const color=wallColor(line.percentile,this.settings.colorMode,line.segment.side),right=Math.max(line.x+1,line.right);
      if(group&&group.segmentId===line.segment.id&&group.epoch===line.segment.epoch&&group.side===line.segment.side&&
        group.color===color&&group.to===line.from&&group.low===line.low&&group.high===line.high&&group.y===line.y&&line.x<=group.right){
        // Adjacent value runs share a source timestamp. Their minimum-width strokes
        // may overlap by subpixel amounts, so extend the union instead of requiring
        // floating-point x equality. Segment identity and time continuity keep gaps
        // and separate wall episodes distinct.
        group.to=line.to;group.right=Math.max(group.right,right);
        continue;
      }
      strokeGroup();
      group={segmentId:line.segment.id,epoch:line.segment.epoch,side:line.segment.side,color,from:line.from,to:line.to,
        x:line.x,right,y:line.y,low:line.low,high:line.high};
    }
    strokeGroup();
    ctx.restore();
    const elapsed=performance.now()-started;this.durations.push(elapsed);if(this.durations.length>512)this.durations.shift();this.stats.renderMs+=elapsed;this.stats.maxRenderMs=Math.max(this.stats.maxRenderMs,elapsed);
  }

  private projectAll(segment:OrderWallSegment,rc:PrimitiveRenderContext){
    if(segment.valueRuns.length){for(let i=0;i<segment.valueRuns.length;i++)this.projectIndex(segment,i,rc);return;}
    const to=segment.end??this.status.lastConfirmedAt??segment.start;
    const line=this.project(segment,0,segment.start,to,null,rc);
    if(line){this.drawable.set(line.key,line);this.drawableKeys.set(segment.id,[line.key]);}
  }
  private projectTail(segment:OrderWallSegment,fromIndex:number,rc:PrimitiveRenderContext){
    if(!segment.valueRuns.length){this.removeDrawables(segment.id);this.projectAll(segment,rc);return;}
    const keys=this.drawableKeys.get(segment.id)??[];
    for(const key of keys){const drawable=this.drawable.get(key);if(drawable&&drawable.runIndex>=fromIndex)this.drawable.delete(key);}
    this.drawableKeys.set(segment.id,keys.filter(key=>this.drawable.has(key)));
    for(let i=fromIndex;i<segment.valueRuns.length;i++)this.projectIndex(segment,i,rc);
  }
  private removeDrawables(id:string){for(const key of this.drawableKeys.get(id)??[])this.drawable.delete(key);this.drawableKeys.delete(id);}
  private projectIndex(segment:OrderWallSegment,index:number,rc:PrimitiveRenderContext){
    const value=segment.valueRuns[index];if(!value)return;
    const next=segment.valueRuns[index+1],from=value.at,to=next?.at??segment.end??this.status.lastConfirmedAt??from;
    const line=this.project(segment,index,from,to,value.percentile,rc);if(!line)return;
    this.drawable.set(line.key,line);const keys=this.drawableKeys.get(segment.id)??[];keys.push(line.key);this.drawableKeys.set(segment.id,keys);
  }
  private project(segment:OrderWallSegment,runIndex:number,from:number,to:number,percentile:number|null,rc:PrimitiveRenderContext):WallDrawable|null{
    if(!this.settings.showHistory&&segment.end!==null)return null;
    if(to<=from)return null;
    const priceWidth=this.width(),low=segment.price,high=low+priceWidth;
    const range=rc.timeScale.visibleRange(),visibleFrom=rc.dataLayer.indexToTimeFloat(range.from)*1000,visibleTo=rc.dataLayer.indexToTimeFloat(range.to)*1000;
    if(to<visibleFrom||from>visibleTo)return null;
    const startLogical=wallTimestampToLogical(from,rc.dataLayer.timeToIndexFloat.bind(rc.dataLayer));
    const endLogical=wallTimestampToLogical(to,rc.dataLayer.timeToIndexFloat.bind(rc.dataLayer));
    if(startLogical===null||endLogical===null)return null;
    const x=rc.timeScale.indexToX(startLogical),right=rc.timeScale.indexToX(endLogical),y=rc.priceScale.priceToY((low+high)/2);
    if(![x,right,y].every(Number.isFinite)||y<0||y>rc.plotHeight||right<0||x>rc.plotWidth)return null;
    const key=`${segment.id}@${from}`;
    return {key,segment,runIndex,from,to,percentile,x:Math.max(0,x),right:Math.min(rc.plotWidth,right),y,low,high};
  }

  orderWallAt(x:number,y:number):OrderWallHit|null{
    let best:WallDrawable|undefined,bestDistance=Infinity;
    const tolerance=Math.max(4,this.settings.thicknessPx/2+2);
    for(const line of this.drawable.values()){
      if(x<line.x||x>Math.max(line.x+1,line.right))continue;
      const distance=Math.abs(y-line.y);if(distance<=tolerance&&distance<bestDistance){best=line;bestDistance=distance;}
    }
    const ratio=best?Math.max(0,Math.min(1,(x-best.x)/Math.max(1,best.right-best.x))):0;
    const projected=best?this.timeAtX?.(x):undefined;
    if(!best)return null;
    const at=Number.isFinite(projected)?projected!:best.from+(best.to-best.from)*ratio;
    return {segment:best.segment,x,y,at,priceLow:best.low,priceHigh:best.high,percentile:orderWallValuePointAt(best.segment,at)?.percentile??null};
  }
  diagnostics(){const sorted=[...this.durations].sort((a,b)=>a-b);return {...this.stats,retainedSegments:this.segments.size,retainedDrawables:this.drawable.size,p95RenderMs:sorted[Math.floor((sorted.length-1)*.95)]??0};}
  private measureBytes(){let runs=0;for(const segment of this.segments.values())runs+=segment.valueRuns.length;this.stats.bytes=this.segments.size*192+runs*24;}
}

function validSegment(value:OrderWallSegment){return !!value&&typeof value.id==='string'
  &&((typeof value.epoch==='string'&&value.epoch.length>0)||(typeof value.epoch==='number'&&Number.isFinite(value.epoch)))
  &&(value.side==='bid'||value.side==='ask')&&
  [value.price,value.start,value.peakUsd,value.meanUsd,value.durationMs].every(Number.isFinite)&&value.price>0&&value.peakUsd>=0&&value.meanUsd>=0&&value.durationMs>=0&&
  (value.end===null||Number.isFinite(value.end))&&(value.percentile===null||Number.isFinite(value.percentile));}
function wallColor(rankValue:number|null,mode:OrderWallsSettings['colorMode'],side:'bid'|'ask'){
  if(mode==='bid-ask')return side==='bid'?'#2ebc79':'#ed5964';
  const rank=rankValue??0;
  return rank>=99.9?'#ff884d':rank>=99?'#f1cb59':'#37c4d2';
}

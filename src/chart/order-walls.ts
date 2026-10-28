import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { orderWallValuePointAt, type OrderWallHit, type OrderWallPatch, type OrderWallSegment, type OrderWallsSettings, type OrderWallStatus } from '../feed/order-walls';

const TOP_HEAT={bid:['#33778c','#45bcd0','#f1cb59','#ff884d'],ask:['#666da5','#8b99eb','#e9c15b','#ff8766']};
const TOP_SIDE={bid:['#28644b','#3d9970','#66d39a','#b6f1aa'],ask:['#7b3f4b','#bf6273','#ed9a9e','#ffd0b0']};

interface WallDrawable { key:string; segment:OrderWallSegment; runIndex:number; from:number; to:number; percentile:number|null; usd:number|null; x:number; right:number; y:number; low:number; high:number }

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
  private closedOrder=new Map<string,boolean>();
  private sizes=new Map<string,number>();
  private reference={min:0,max:0};
  private referenceDirty=true;
  private timeAtX?:(x:number)=>number;
  readonly stats={draws:0,rebuilds:0,patchProjects:0,segments:0,visible:0,bytes:0,renderMs:0,maxRenderMs:0,strokes:0,lastProjectMs:0,lastReferenceMs:0,lastPaintMs:0};
  private durations:number[]=[];

  constructor(settings:OrderWallsSettings,intervalMs:number){this.settings={...settings};this.intervalMs=intervalMs;}
  zOrder(){return 'normal' as const;}
  autoscaleInfo(){return null;}
  attached(host:PrimitiveHost){this.host=host;}
  detached(){this.closedOrder.clear();this.sizes.clear();this.host=undefined;this.segments.clear();this.drawable.clear();this.drawableKeys.clear();this.dirty.clear();this.tailDirty.clear();this.timeAtX=undefined;this.stats.bytes=0;}
  setSettings(settings:OrderWallsSettings){this.settings={...settings};this.trimHistory();this.referenceDirty=true;this.version++;this.host?.requestUpdate();}
  setInterval(intervalMs:number){if(this.intervalMs!==intervalMs){this.intervalMs=intervalMs;this.transformKey='';this.host?.requestUpdate();}}
  setStatus(status:OrderWallStatus){
    const prior=this.status.lastConfirmedAt;this.status={...status};
    if(prior!==status.lastConfirmedAt)for(const[id,segment]of this.segments)if(segment.end===null)this.markTail(id,Math.max(0,segment.valueRuns.length-1));
    this.host?.requestUpdate();
  }
  setSnapshot(segments:OrderWallSegment[],status:OrderWallStatus){
    this.status={...status};this.closedOrder.clear();this.sizes.clear();this.segments.clear();this.drawable.clear();this.drawableKeys.clear();this.tailDirty.clear();
    for(const segment of segments)if(validSegment(segment)&&!this.beforeRetention(segment))this.segments.set(segment.id,segment);
    for(const segment of [...this.segments.values()].filter(s=>s.end!==null).sort((a,b)=>a.end!-b.end!))this.closedOrder.set(segment.id,true);
    this.trimHistory();
    this.dirty=new Set(this.segments.keys());this.version++;this.transformKey='';this.measureBytes();this.host?.requestUpdate();
  }
  patch(patches:OrderWallPatch[],status:OrderWallStatus){
    this.status={...status};
    for(const patch of patches){
      if(!patch.segment||!validSegment(patch.segment)||this.beforeRetention(patch.segment)){
        this.dirty.add(patch.id);this.tailDirty.delete(patch.id);this.segments.delete(patch.id);this.closedOrder.delete(patch.id);continue;
      }
      const previous=this.segments.get(patch.id),next=patch.segment;
      this.segments.set(patch.id,next);
      const shifted=Boolean(previous&&(previous.valueRunsTruncated!==next.valueRunsTruncated||
        (previous.valueRuns[0]&&next.valueRuns[0]&&previous.valueRuns[0].at!==next.valueRuns[0].at)));
      if(!previous||shifted||previous.price!==next.price||previous.start!==next.start){this.dirty.add(patch.id);this.tailDirty.delete(patch.id);}
      else this.markTail(patch.id,Math.max(0,previous.valueRuns.length-1));
    }
    for(const patch of patches){const next=this.segments.get(patch.id);if(next?.end!==null&&next&&!this.closedOrder.has(patch.id))this.closedOrder.set(patch.id,true);this.measureOne(patch.id);}
    this.trimHistory();this.referenceDirty=true;this.host?.requestUpdate();
  }
  private trimHistory(){while(this.closedOrder.size>this.settings.historyEpisodes){const id=this.closedOrder.keys().next().value!;this.closedOrder.delete(id);this.segments.delete(id);this.dirty.add(id);this.measureOne(id);}}
  private beforeRetention(segment:OrderWallSegment){return this.status.retentionStart!==undefined&&(segment.end??this.status.lastConfirmedAt??segment.start)<=this.status.retentionStart;}
  private width(){return this.settings.aggregation==='native'?this.status.tickSize??.1:this.settings.aggregation==='auto'?this.status.resolvedPriceWidth??this.status.tickSize??.1:this.settings.aggregation;}
  private markTail(id:string,index:number){if(this.dirty.has(id))return;this.tailDirty.set(id,Math.min(index,this.tailDirty.get(id)??index));}

  draw(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){
    if(!this.settings.enabled||!this.segments.size)return;
    const started=performance.now(),range=rc.timeScale.visibleRange(),prices=rc.priceScale.priceRange(),dpr=rc.dpr;
    // Primitive hit inputs are plot-local CSS pixels, like indexToX/projected lines.
    // Only drawing coordinates are multiplied by DPR.
    this.timeAtX=x=>rc.dataLayer.indexToTimeFloat(rc.timeScale.xToIndex(x))*1000;
    const key=[this.version,this.intervalMs,range.from,range.to,prices.min,prices.max,rc.plotWidth,rc.plotHeight,dpr,
      rc.dataLayer.length,rc.dataLayer.indexToTime(0),rc.dataLayer.indexToTime(rc.dataLayer.baseIndex),this.width()].join(':');
    if(key!==this.transformKey){this.referenceDirty=true;this.drawable.clear();this.drawableKeys.clear();this.tailDirty.clear();this.dirty=new Set(this.segments.keys());this.transformKey=key;this.stats.rebuilds++;}
    const projectionStarted=performance.now();
    if(this.dirty.size){
      for(const id of this.dirty){this.removeDrawables(id);const segment=this.segments.get(id);if(segment)this.projectAll(segment,rc);this.stats.patchProjects++;}
      this.dirty.clear();
    }
    if(this.tailDirty.size){for(const[id,index]of this.tailDirty){const segment=this.segments.get(id);if(segment)this.projectTail(segment,index,rc);this.stats.patchProjects++;}this.tailDirty.clear();}
    this.stats.lastProjectMs=performance.now()-projectionStarted;const referenceStarted=performance.now();
    if(this.referenceDirty){let min=Infinity,max=0;
      const accept=(v:number|null)=>{if(v!==null&&v>0){min=Math.min(min,v);max=Math.max(max,v);}};
      if(this.settings.visibleRangeOnly)for(const line of this.drawable.values())accept(line.usd);
      else for(const segment of this.segments.values())if(this.settings.showHistory||segment.end===null)for(const run of segment.valueRuns)accept(run.usd);
      this.reference={min:Number.isFinite(min)?min:0,max};this.referenceDirty=false;
    }
    this.stats.lastReferenceMs=performance.now()-referenceStarted;const paintStarted=performance.now();this.stats.strokes=0;
    this.stats.draws++;this.stats.segments=this.segments.size;this.stats.visible=this.drawable.size;
    ctx.save();ctx.beginPath();ctx.rect(0,0,rc.plotWidth*dpr,rc.plotHeight*dpr);ctx.clip();
    ctx.globalAlpha=this.settings.opacity;ctx.lineWidth=this.settings.thicknessPx*dpr;ctx.lineCap='butt';ctx.setLineDash([]);
    let group:{segmentId:string;epoch:string|number;side:'bid'|'ask';color:string;thickness:number;top:boolean;from:number;to:number;x:number;right:number;y:number;low:number;high:number}|undefined;
    const paths=new Map<string,{color:string;thickness:number;lines:Array<[number,number,number]>}>();
    const strokeGroup=()=>{
      if(!group)return;
      if(group.top){const key=`${group.color}:${group.thickness}`,path=paths.get(key)??{color:group.color,thickness:group.thickness,lines:[]};path.lines.push([group.x,group.right,group.y]);paths.set(key,path);}
      else{ctx.lineWidth=group.thickness*dpr;ctx.strokeStyle=group.color;ctx.beginPath();ctx.moveTo(group.x*dpr,group.y*dpr);ctx.lineTo(group.right*dpr,group.y*dpr);ctx.stroke();this.stats.strokes++;}
      group=undefined;
    };
    for(const line of this.drawable.values()){
      const style=this.lineStyle(line),color=style.color,right=Math.max(line.x+(line.segment.detectionMode==='top-levels'?1/dpr:1),line.right);
      if(group&&group.segmentId===line.segment.id&&group.epoch===line.segment.epoch&&group.side===line.segment.side&&
        group.color===color&&group.thickness===style.thickness&&group.to===line.from&&group.low===line.low&&group.high===line.high&&group.y===line.y&&line.x<=group.right){
        // Adjacent value runs share a source timestamp. Their minimum-width strokes
        // may overlap by subpixel amounts, so extend the union instead of requiring
        // floating-point x equality. Segment identity and time continuity keep gaps
        // and separate wall episodes distinct.
        group.to=line.to;group.right=Math.max(group.right,right);
        continue;
      }
      strokeGroup();
      group={segmentId:line.segment.id,epoch:line.segment.epoch,side:line.segment.side,color,thickness:style.thickness,top:line.segment.detectionMode==='top-levels',from:line.from,to:line.to,
        x:line.x,right,y:line.y,low:line.low,high:line.high};
    }
    strokeGroup();
    for(const path of paths.values()){
      ctx.strokeStyle=path.color;ctx.lineWidth=path.thickness*dpr;ctx.beginPath();
      for(const[x,right,y]of path.lines){ctx.moveTo(x*dpr,y*dpr);ctx.lineTo(right*dpr,y*dpr);}ctx.stroke();this.stats.strokes++;
    }
    if(this.settings.showPriceLines)this.drawPriceLines(ctx,rc);
    ctx.restore();
    this.stats.lastPaintMs=performance.now()-paintStarted;
    const elapsed=performance.now()-started;this.durations.push(elapsed);if(this.durations.length>512)this.durations.shift();this.stats.renderMs+=elapsed;this.stats.maxRenderMs=Math.max(this.stats.maxRenderMs,elapsed);
  }

  /** Presentation-only guides: never extend the recorded wall timeline itself. */
  private drawPriceLines(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){
    const active=new Map<string,WallDrawable>();
    for(const line of this.drawable.values()){
      const segment=this.segments.get(line.segment.id);
      if(!segment||segment.end!==null)continue;
      const previous=active.get(line.segment.id);
      if(!previous||line.from>previous.from)active.set(line.segment.id,line);
    }
    const dpr=rc.dpr,occupied:number[]=[];
    ctx.font=`${10*dpr}px ui-monospace, monospace`;ctx.textBaseline='middle';ctx.textAlign='right';
    // Strongest labels win crowded rows; guides stay aligned with actual wall prices.
    const lines=[...active.values()].map(line=>({line,segment:this.segments.get(line.segment.id)!})).sort((a,b)=>(b.segment.valueRuns.at(-1)?.usd??0)-(a.segment.valueRuns.at(-1)?.usd??0));
    for(const {line,segment} of lines){
      const value=orderWallValuePointAt(segment,Math.min(line.to,this.status.lastConfirmedAt??line.to));
      if(!value||!Number.isFinite(value.usd)||line.y<8||line.y>rc.plotHeight-8)continue;
      const color=this.lineStyle({...line,usd:value.usd,percentile:value.percentile}).color;
      ctx.strokeStyle=color;ctx.globalAlpha=this.settings.opacity*.28;ctx.lineWidth=dpr;ctx.setLineDash([2*dpr,4*dpr]);
      if(line.segment.detectionMode!=='top-levels'){ctx.beginPath();ctx.moveTo(0,line.y*dpr);ctx.lineTo(rc.plotWidth*dpr,line.y*dpr);ctx.stroke();}
      if(occupied.some(y=>Math.abs(y-line.y)<15))continue;
      const price=(this.settings.aggregation==='native'?line.low:(line.low+line.high)/2).toLocaleString('en-US',{maximumFractionDigits:8});
      const size=value.usd.toLocaleString('en-US',{notation:'compact',maximumFractionDigits:1});
      const stale=this.status.state!=='live'?'~':'';
      const text=`${stale}${line.segment.side==='bid'?'B':'A'} ${price} · $${size}`;
      const width=ctx.measureText(text).width+10*dpr;
      if(width>rc.plotWidth*dpr-8*dpr)continue;
      occupied.push(line.y);
      ctx.globalAlpha=.94;ctx.fillStyle=rc.theme.background;ctx.fillRect(rc.plotWidth*dpr-width-4*dpr,(line.y-7)*dpr,width,14*dpr);
      ctx.globalAlpha=this.settings.opacity*.45;ctx.strokeStyle=color;ctx.setLineDash([]);ctx.strokeRect(rc.plotWidth*dpr-width-4*dpr,(line.y-7)*dpr,width,14*dpr);
      ctx.globalAlpha=this.settings.opacity;ctx.fillStyle=rc.theme.axisText;ctx.fillText(text,(rc.plotWidth-9)*dpr,line.y*dpr);
    }
  }

  private lineStyle(line:WallDrawable){
    if(line.segment.detectionMode!=='top-levels')return {color:wallColor(line.percentile,this.settings.colorMode,line.segment.side),thickness:this.settings.thicknessPx};
    if(line.usd===null)return {color:'#6b6b6b',thickness:1};
    const {min,max}=this.reference,v=line.usd??min;
    const strength=max<=0?0:this.settings.highContrast?(max===min ? .5 :Math.max(0,Math.min(1,(v-min)/(max-min)))):Math.max(0,Math.min(1,v/max));
    const tier=strength>=.85?3:strength>=.55?2:strength>=.25?1:0;
    const heat=TOP_HEAT[line.segment.side],side=TOP_SIDE[line.segment.side];
    return {color:(this.settings.colorMode==='heat'?heat:side)[tier]!,thickness:this.settings.strengthThickness?1+(this.settings.thicknessPx-1)*tier/3:this.settings.thicknessPx};
  }

  private projectAll(segment:OrderWallSegment,rc:PrimitiveRenderContext){
    if(segment.detectionMode==='top-levels'&&segment.valueRunsTruncated&&segment.valueRuns.length>0&&segment.valueRuns[0]!.at>segment.start){
      const line=this.project(segment,-1,segment.start,segment.valueRuns[0]!.at,null,rc);
      if(line){this.drawable.set(line.key,line);this.drawableKeys.set(segment.id,[line.key]);}
    }
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
    if(!this.settings.showHistory&&segment.end!==null||segment.durationMs<this.settings.minDurationMs)return null;
    from=Math.max(from,segment.start+this.settings.minDurationMs);
    if(to<=from)return null;
    const priceWidth=this.width(),low=segment.price,high=low+priceWidth;
    const range=rc.timeScale.visibleRange(),visibleFrom=rc.dataLayer.indexToTimeFloat(range.from)*1000,visibleTo=rc.dataLayer.indexToTimeFloat(range.to)*1000;
    if(to<visibleFrom||from>visibleTo)return null;
    const startLogical=wallTimestampToLogical(from,rc.dataLayer.timeToIndexFloat.bind(rc.dataLayer));
    const endLogical=wallTimestampToLogical(to,rc.dataLayer.timeToIndexFloat.bind(rc.dataLayer));
    if(startLogical===null||endLogical===null)return null;
    const x=rc.timeScale.indexToX(startLogical),right=rc.timeScale.indexToX(endLogical),y=rc.priceScale.priceToY(this.settings.aggregation==='native'?low:(low+high)/2);
    if(![x,right,y].every(Number.isFinite)||y<0||y>rc.plotHeight||right<0||x>rc.plotWidth)return null;
    const key=`${segment.id}@${from}`;
    return {key,segment,runIndex,from,to,percentile,usd:segment.valueRuns[runIndex]?.usd??null,x:Math.max(0,x),right:Math.min(rc.plotWidth,right),y,low,high};
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
    const segment=this.segments.get(best.segment.id)??best.segment;
    return {segment,x,y,at,priceLow:best.low,priceHigh:best.high,percentile:orderWallValuePointAt(segment,at)?.percentile??null};
  }
  diagnostics(){const sorted=[...this.durations].sort((a,b)=>a-b);return {...this.stats,retainedSegments:this.segments.size,retainedDrawables:this.drawable.size,p95RenderMs:sorted[Math.floor((sorted.length-1)*.95)]??0};}
  private measureOne(id:string){const before=this.sizes.get(id)??0,s=this.segments.get(id);const next=s?192+s.valueRuns.length*40:0;this.stats.bytes+=next-before;if(next)this.sizes.set(id,next);else this.sizes.delete(id);}
  private measureBytes(){this.stats.bytes=0;this.sizes.clear();for(const id of this.segments.keys())this.measureOne(id);this.referenceDirty=true;}
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

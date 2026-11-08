import {OrderWallRankIndex} from '../feed/order-wall-rank';
import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { ORDER_WALL_ARCHIVE_MAX_SEGMENTS } from '../feed/order-walls';
import { orderWallValuePointAt, type OrderWallHit, type OrderWallPatch, type OrderWallSegment, type OrderWallsSettings, type OrderWallStatus } from '../feed/order-walls';

const TOP_HEAT={bid:['#33778c','#45bcd0','#f1cb59','#ff884d'],ask:['#666da5','#8b99eb','#e9c15b','#ff8766']};
const TOP_SIDE={bid:['#28644b','#3d9970','#66d39a','#b6f1aa'],ask:['#7b3f4b','#bf6273','#ed9a9e','#ffd0b0']};

interface WallDrawable { key:string; segment:OrderWallSegment; runIndex:number; from:number; to:number; percentile:number|null; usd:number|null; x:number; right:number; y:number; low:number; high:number; paintOrder:number }
interface WallPaintBucket {color:string;thickness:number;path:Path2D;firstOrder:number;historical:number;current:number}

/** The chart data layer preserves sub-candle event times as fractional logical indices. */
export function wallTimestampToLogical(timeMs:number,timeToIndexFloat:(seconds:number)=>number):number|null {
  if(!Number.isFinite(timeMs))return null;
  const logical=timeToIndexFloat(timeMs/1000);
  return Number.isFinite(logical)?logical:null;
}

/** Exact knots of the public piecewise-linear time mapping, relative to the
 * visible origin. Axis padding/tail changes outside these knots do not move
 * visible geometry. Keep work bounded; an unprovable mapping disables reuse. */
export function wallProjectionMappingKey(rc:PrimitiveRenderContext):string|undefined {
  const range=rc.timeScale.visibleRange(),lo=Math.floor(range.from),hi=Math.ceil(range.to);
  if(!Number.isSafeInteger(lo)||!Number.isSafeInteger(hi)||!(range.to>range.from)||hi-lo>4096)return;
  const values=[range.to-range.from,rc.timeScale.indexToX(range.from),rc.timeScale.indexToX(range.to)];
  for(let index=lo;index<=hi;index++)values.push(index-range.from,rc.dataLayer.indexToTimeFloat(index));
  if(values.some(value=>!Number.isFinite(value)))return;
  return values.join(':');
}

export class OrderWallsPrimitive implements IPrimitive {
  private host?:PrimitiveHost;
  private settings:OrderWallsSettings;
  private intervalMs:number;
  private status:OrderWallStatus={state:'loading'};
  private segments=new Map<string,OrderWallSegment>();
  private openIds=new Set<string>();
  private drawable=new Map<string,WallDrawable>();
  private drawableKeys=new Map<string,string[]>();
  private version=0;
  private transformKey='';
  private dirty=new Set<string>();
  private tailDirty=new Map<string,number>();
  private closedDirectOrder=new Map<string,boolean>();
  private closedArchiveOrder=new Map<string,boolean>();
  private archiveEpisodeHistoryLimited=false;
  private sizes=new Map<string,number>();
  private reference={min:0,max:0};
  private referenceDirty=true;
  private referenceIds=new Set<string>();
  private referenceExtents=new Map<string,{min:number;max:number}>();
  private referenceCounts=new Map<number,number>();
  private referenceIndex=new OrderWallRankIndex();
  private timeAtX?:(x:number)=>number;
  private paintInvalid=true;
  private paintKey='';
  private paintPaths?:Array<{color:string;thickness:number;path:Path2D}>;
  private closedPaintPaths?:WallPaintBucket[];
  private closedPaintKey='';
  private closedPaintInvalid=true;
  private closedPaintMembers=new Set<string>();
  private closedPaintDirty=new Set<string>();
  private nextPaintOrder=0;
  private nonTopDrawables=0;
  private paintCounts={historical:0,current:0};
  private inputRevision=0;
  private paintedRevision=-1;
  private paintedViewport?:{fromMs:number;toMs:number;minPrice:number;maxPrice:number;plotWidth:number;plotHeight:number};
  readonly stats={draws:0,rebuilds:0,patchProjects:0,segments:0,visible:0,visibleHistorical:0,visibleCurrent:0,bytes:0,renderMs:0,maxRenderMs:0,strokes:0,lastProjectMs:0,lastReferenceMs:0,lastPaintMs:0,referenceRebuilds:0,referenceSegments:0,referenceValueScans:0,paintCacheHits:0,paintCacheBuilds:0,paintStyleVisits:0,closedPaintCacheHits:0,closedPaintCacheBuilds:0,closedPaintCacheAppends:0,closedPaintStyleVisits:0,settingsNoops:0,mappingChecks:0,mappingFallbacks:0};
  private durations:number[]=[];

  constructor(settings:OrderWallsSettings,intervalMs:number,private readonly cachePaintPaths=true){this.settings={...settings};this.intervalMs=intervalMs;}
  zOrder(){return 'normal' as const;}
  autoscaleInfo(){return null;}
  attached(host:PrimitiveHost){this.host=host;}
  detached(){this.clearEmptyProjection();this.openIds.clear();this.closedDirectOrder.clear();this.closedArchiveOrder.clear();this.sizes.clear();this.host=undefined;this.segments.clear();this.timeAtX=undefined;this.stats.bytes=0;}
  setSettings(settings:OrderWallsSettings){
    // Panel reconciliation also runs after native/history status changes. The
    // canonical settings are flat; an equivalent fresh object changes no input
    // and must not invalidate tens of thousands of closed value geometries.
    const keys=Object.keys(settings) as Array<keyof OrderWallsSettings>;
    if(keys.length===Object.keys(this.settings).length&&keys.every(key=>Object.is(settings[key],this.settings[key]))){this.stats.settingsNoops++;return;}
    this.inputRevision++;this.settings={...settings};this.trimHistory();this.referenceDirty=true;this.version++;this.host?.requestUpdate();}
  setInterval(intervalMs:number){if(this.intervalMs!==intervalMs){this.inputRevision++;this.intervalMs=intervalMs;this.transformKey='';this.host?.requestUpdate();}}
  setStatus(status:OrderWallStatus){
    this.inputRevision++;
    const prior=this.status;this.status=this.effectiveStatus(status);
    this.advanceOpenTails(prior);
    this.host?.requestUpdate();
  }
  setSnapshot(segments:OrderWallSegment[],status:OrderWallStatus){
    this.inputRevision++;
    this.status={...status};this.archiveEpisodeHistoryLimited=status.episodeHistoryLimited===true;
    this.clearEmptyProjection();this.openIds.clear();this.closedDirectOrder.clear();this.closedArchiveOrder.clear();this.sizes.clear();this.segments.clear();
    for(const segment of segments)if(validSegment(segment)&&!this.beforeRetention(segment)){this.segments.set(segment.id,segment);if(segment.end===null)this.openIds.add(segment.id);}
    for(const segment of [...this.segments.values()].filter(s=>s.end!==null).sort((a,b)=>a.end!-b.end!))this.rememberClosed(segment);
    this.trimHistory();this.status=this.effectiveStatus(status);
    this.dirty=new Set(this.segments.keys());this.version++;this.transformKey='';this.measureBytes();this.host?.requestUpdate();
  }
  patch(patches:OrderWallPatch[],status:OrderWallStatus){
    this.inputRevision++;
    const prior=this.status;this.status={...status};
    for(const patch of patches){
      if(!patch.segment||!validSegment(patch.segment)||this.beforeRetention(patch.segment)){
        this.segments.delete(patch.id);this.openIds.delete(patch.id);this.removeProjection(patch.id);
        this.closedDirectOrder.delete(patch.id);this.closedArchiveOrder.delete(patch.id);continue;
      }
      const previous=this.segments.get(patch.id),next=patch.segment;
      this.segments.set(patch.id,next);if(next.end===null)this.openIds.add(patch.id);else this.openIds.delete(patch.id);
      const shifted=Boolean(previous&&(previous.valueRunsTruncated!==next.valueRunsTruncated||
        (previous.valueRuns[0]&&next.valueRuns[0]&&previous.valueRuns[0].at!==next.valueRuns[0].at)));
      if(!previous||patch.replaceValueRuns===true||shifted||previous.price!==next.price||previous.start!==next.start){this.dirty.add(patch.id);this.tailDirty.delete(patch.id);}
      else this.markTail(patch.id,Math.max(0,next.valueRuns.length-(patch.valuePoints?.length??0)-1));
    }
    for(const patch of patches){const next=this.segments.get(patch.id);if(next?.end!==null&&next)this.rememberClosed(next);
      else {this.closedDirectOrder.delete(patch.id);this.closedArchiveOrder.delete(patch.id);}this.measureOne(patch.id);this.markReference(patch.id);}
    this.trimHistory();this.status=this.effectiveStatus(status);this.advanceOpenTails(prior);if(!this.segments.size)this.clearEmptyProjection();this.host?.requestUpdate();
  }
  private removeProjection(id:string){
    this.removeDrawables(id);this.dirty.delete(id);this.tailDirty.delete(id);this.referenceIds.delete(id);
    this.closedPaintDirty.delete(id);if(this.closedPaintMembers.delete(id))this.invalidateClosedPaint();
    const extent=this.referenceExtents.get(id);
    if(extent){this.countReference(extent.min,-1);this.countReference(extent.max,-1);this.referenceExtents.delete(id);}
  }
  private clearEmptyProjection(){
    this.paintedViewport=undefined;this.paintPaths=undefined;this.paintInvalid=true;this.paintKey='';this.paintCounts={historical:0,current:0};
    this.closedPaintPaths=undefined;this.closedPaintKey='';this.closedPaintInvalid=true;
    this.closedPaintMembers.clear();this.closedPaintDirty.clear();
    this.drawable.clear();this.nonTopDrawables=0;this.drawableKeys.clear();this.dirty.clear();this.tailDirty.clear();this.clearReference();this.referenceDirty=true;
    this.stats.referenceSegments=0;this.stats.referenceValueScans=0;this.stats.segments=0;this.stats.visible=0;this.stats.visibleHistorical=0;this.stats.visibleCurrent=0;
  }
  private markReference(id:string){
    if(this.referenceDirty){this.referenceIds.clear();return;}
    if(this.segments.has(id)||this.referenceExtents.has(id))this.referenceIds.add(id);else this.referenceIds.delete(id);
  }
  private clearReference(){
    this.reference={min:0,max:0};
    this.referenceIds.clear();this.referenceExtents.clear();this.referenceCounts.clear();this.referenceIndex.clear();
  }
  private countReference(value:number,delta:number){
    const count=(this.referenceCounts.get(value)??0)+delta;
    if(count>0)this.referenceCounts.set(value,count);else this.referenceCounts.delete(value);
    this.referenceIndex.set(value,Math.max(0,count));
  }
  private updateReference(id:string){
    const previous=this.referenceExtents.get(id);
    this.stats.referenceSegments++;
    let min=Infinity,max=0;
    const accept=(value:number|null)=>{this.stats.referenceValueScans++;if(value!==null&&value>0){min=Math.min(min,value);max=Math.max(max,value);}};
    if(this.settings.visibleRangeOnly){for(const key of this.drawableKeys.get(id)??[]){const line=this.drawable.get(key);if(line)accept(line.usd);}}
    else {const segment=this.segments.get(id);if(segment&&(this.settings.showHistory||segment.end===null))for(const run of segment.valueRuns)accept(run.usd);}
    if(previous&&previous.min===min&&previous.max===max)return;
    if(previous){this.countReference(previous.min,-1);this.countReference(previous.max,-1);this.referenceExtents.delete(id);}
    if(max>0){this.referenceExtents.set(id,{min,max});this.countReference(min,1);this.countReference(max,1);}
  }
  private rememberClosed(segment:OrderWallSegment){
    if(isArchiveSegment(segment))this.closedArchiveOrder.set(segment.id,true);
    else this.closedDirectOrder.set(segment.id,true);
  }
  private trimHistory(){
    while(this.closedDirectOrder.size>this.settings.historyEpisodes){const id=this.closedDirectOrder.keys().next().value!;
      this.closedDirectOrder.delete(id);this.segments.delete(id);this.removeProjection(id);this.measureOne(id);}
    while(this.closedArchiveOrder.size>ORDER_WALL_ARCHIVE_MAX_SEGMENTS){const id=this.closedArchiveOrder.keys().next().value!;
      this.closedArchiveOrder.delete(id);this.segments.delete(id);this.removeProjection(id);this.measureOne(id);this.archiveEpisodeHistoryLimited=true;}
  }
  private effectiveStatus(status:OrderWallStatus):OrderWallStatus{
    return this.archiveEpisodeHistoryLimited?{...status,episodeHistoryLimited:true,
      ...(status.coverage?{coverage:{...status.coverage,complete:false,partial:true}}:{})}:status;
  }
  private beforeRetention(segment:OrderWallSegment){return this.status.retentionStart!==undefined&&(segment.end??this.status.lastConfirmedAt??segment.start)<=this.status.retentionStart;}
  private width(){return this.settings.aggregation==='native'?this.status.tickSize??.1:this.settings.aggregation==='auto'?this.status.resolvedPriceWidth??this.status.tickSize??.1:this.settings.aggregation;}
  private archivePaintThrough(status:OrderWallStatus){const a=status.archive?.loadedThrough,b=status.archive?.presentationThrough;return a===undefined?b:b===undefined?a:Math.max(a,b);}
  private advanceOpenTails(prior:OrderWallStatus){
    const current=prior.lastConfirmedAt!==this.status.lastConfirmedAt,archive=this.archivePaintThrough(prior)!==this.archivePaintThrough(this.status);
    if(!current&&!archive)return;
    for(const id of this.openIds){const segment=this.segments.get(id);if(segment&&(segment.archiveEntryId&&!segment.currentSelection?archive:current))this.markTail(id,Math.max(0,segment.valueRuns.length-1));}
  }
  private markTail(id:string,index:number){if(this.dirty.has(id))return;this.tailDirty.set(id,Math.min(index,this.tailDirty.get(id)??index));}

  draw(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){
    if(!this.settings.enabled||!this.segments.size)return;
    const started=performance.now(),range=rc.timeScale.visibleRange(),prices=rc.priceScale.priceRange(),dpr=rc.dpr;
    // Primitive hit inputs are plot-local CSS pixels, like indexToX/projected lines.
    // Only drawing coordinates are multiplied by DPR.
    this.timeAtX=x=>rc.dataLayer.indexToTimeFloat(rc.timeScale.xToIndex(x))*1000;
    this.stats.mappingChecks++;
    const mapping=wallProjectionMappingKey(rc);
    if(mapping===undefined)this.stats.mappingFallbacks++;
    const axis=mapping??`unproven:${this.stats.mappingChecks}`;
    const key=[this.version,this.intervalMs,prices.min,prices.max,rc.plotWidth,rc.plotHeight,dpr,this.width(),axis].join(':');
    if(key!==this.transformKey){if(this.settings.visibleRangeOnly)this.referenceDirty=true;this.closedPaintInvalid=true;this.drawable.clear();this.nonTopDrawables=0;this.drawableKeys.clear();this.tailDirty.clear();this.dirty=new Set(this.segments.keys());this.transformKey=key;this.stats.rebuilds++;}
    const projectionStarted=performance.now();
    if(this.dirty.size){
      for(const id of this.dirty){if(this.settings.visibleRangeOnly)this.markReference(id);this.removeDrawables(id);const segment=this.segments.get(id);if(segment)this.projectAll(segment,rc);this.stats.patchProjects++;}
      this.dirty.clear();
    }
    if(this.tailDirty.size){for(const[id,index]of this.tailDirty){if(this.settings.visibleRangeOnly)this.markReference(id);const segment=this.segments.get(id);if(segment)this.projectTail(segment,index,rc);this.stats.patchProjects++;}this.tailDirty.clear();}
    this.stats.lastProjectMs=performance.now()-projectionStarted;const referenceStarted=performance.now();
    this.stats.referenceSegments=0;this.stats.referenceValueScans=0;
    if(this.referenceDirty){
      this.clearReference();this.stats.referenceRebuilds++;
      for(const id of this.settings.visibleRangeOnly?this.drawableKeys.keys():this.segments.keys())this.updateReference(id);
      this.referenceDirty=false;
    }else for(const id of this.referenceIds)this.updateReference(id);
    this.referenceIds.clear();
    const referenceMin=this.referenceIndex.min;
    this.reference={min:referenceMin!==undefined&&Number.isFinite(referenceMin)?referenceMin:0,max:this.referenceIndex.max??0};
    this.stats.lastReferenceMs=performance.now()-referenceStarted;const paintStarted=performance.now();this.stats.strokes=0;
    this.stats.visibleHistorical=0;this.stats.visibleCurrent=0;
    this.stats.draws++;this.stats.segments=this.segments.size;this.stats.visible=this.drawable.size;
    ctx.save();ctx.beginPath();ctx.rect(0,0,rc.plotWidth*dpr,rc.plotHeight*dpr);ctx.clip();
    ctx.globalAlpha=this.settings.opacity;ctx.lineWidth=this.settings.thicknessPx*dpr;ctx.lineCap='butt';ctx.setLineDash([]);
    const paintKey=key+':'+this.reference.min+':'+this.reference.max;
    const cacheable=this.cachePaintPaths&&typeof Path2D!=='undefined';
    if(cacheable&&!this.paintInvalid&&this.paintKey===paintKey&&this.paintPaths){
      for(const entry of this.paintPaths){ctx.strokeStyle=entry.color;ctx.lineWidth=entry.thickness*dpr;ctx.stroke(entry.path);this.stats.strokes++;}
      this.stats.visibleHistorical=this.paintCounts.historical;this.stats.visibleCurrent=this.paintCounts.current;this.stats.paintCacheHits++;
    }else{
    const incremental=cacheable&&typeof Path2D.prototype.addPath==='function'?this.topLevelPaintPaths(paintKey,dpr):undefined;
    if(incremental){
      this.paintPaths=incremental;
      for(const entry of incremental){ctx.strokeStyle=entry.color;ctx.lineWidth=entry.thickness*dpr;ctx.stroke(entry.path);this.stats.strokes++;}
      this.paintKey=paintKey;this.paintInvalid=false;this.paintCounts={historical:this.stats.visibleHistorical,current:this.stats.visibleCurrent};this.stats.paintCacheBuilds++;
    }else{
    const compiled:Array<{color:string;thickness:number;path:Path2D}>=[];
    const stroke=(color:string,thickness:number,lines:Array<[number,number,number]>)=>{
      ctx.strokeStyle=color;ctx.lineWidth=thickness*dpr;
      if(cacheable){const path=new Path2D();for(const[x,right,y]of lines){path.moveTo(x*dpr,y*dpr);path.lineTo(right*dpr,y*dpr);}ctx.stroke(path);compiled.push({color,thickness,path});}
      else{ctx.beginPath();for(const[x,right,y]of lines){ctx.moveTo(x*dpr,y*dpr);ctx.lineTo(right*dpr,y*dpr);}ctx.stroke();}
      this.stats.strokes++;
    };
    let group:{segmentId:string;epoch:string|number;side:'bid'|'ask';color:string;thickness:number;top:boolean;from:number;to:number;x:number;right:number;y:number;low:number;high:number}|undefined;
    const paths=new Map<string,{color:string;thickness:number;lines:Array<[number,number,number]>}>();
    const strokeGroup=()=>{
      if(!group)return;
      if(group.top){const key=`${group.color}:${group.thickness}`,path=paths.get(key)??{color:group.color,thickness:group.thickness,lines:[]};path.lines.push([group.x,group.right,group.y]);paths.set(key,path);}
      else stroke(group.color,group.thickness,[[group.x,group.right,group.y]]);
      group=undefined;
    };
    for(const line of this.drawable.values()){
      this.stats.paintStyleVisits++;
      if(line.segment.currentSelection)this.stats.visibleCurrent++;else if(line.segment.archiveEntryId)this.stats.visibleHistorical++;
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
      stroke(path.color,path.thickness,path.lines);
    }
    this.paintPaths=cacheable?compiled:undefined;this.paintKey=paintKey;this.paintInvalid=false;
    this.paintCounts={historical:this.stats.visibleHistorical,current:this.stats.visibleCurrent};if(cacheable)this.stats.paintCacheBuilds++;
    }
    }
    if(this.settings.showPriceLines)this.drawPriceLines(ctx,rc);
    ctx.restore();
    this.paintedRevision=this.inputRevision;
    this.paintedViewport={fromMs:rc.dataLayer.indexToTimeFloat(range.from)*1000,toMs:rc.dataLayer.indexToTimeFloat(range.to)*1000,minPrice:prices.min,maxPrice:prices.max,plotWidth:rc.plotWidth,plotHeight:rc.plotHeight};
    this.stats.lastPaintMs=performance.now()-paintStarted;
    const elapsed=performance.now()-started;this.durations.push(elapsed);if(this.durations.length>512)this.durations.shift();this.stats.renderMs+=elapsed;this.stats.maxRenderMs=Math.max(this.stats.maxRenderMs,elapsed);
  }

  /** Closed paths hold only native geometry and scalar paint metadata. Dynamic
   * tails are combined into the same style stroke, preserving alpha at overlap.
   * Mixed/Threshold geometry retains the incumbent ordered renderer. */
  private topLevelPaintPaths(key:string,dpr:number):Array<{color:string;thickness:number;path:Path2D}>|undefined {
    if(this.nonTopDrawables){this.closedPaintPaths=undefined;this.closedPaintKey='';this.closedPaintInvalid=true;this.closedPaintMembers.clear();this.closedPaintDirty.clear();return;}
    if(this.closedPaintInvalid||this.closedPaintKey!==key){
      const self=this;
      function* closed(){for(const line of self.drawable.values())if(!self.openIds.has(line.segment.id))yield line;}
      this.closedPaintPaths=this.compileTopPaths(closed(),dpr,true);this.closedPaintKey=key;this.closedPaintInvalid=false;
      this.closedPaintMembers.clear();this.closedPaintDirty.clear();
      for(const [id,keys]of this.drawableKeys)if(keys.length&&!this.openIds.has(id))this.closedPaintMembers.add(id);
      if(this.closedPaintPaths)this.stats.closedPaintCacheBuilds++;
    }else if(this.closedPaintPaths)this.stats.closedPaintCacheHits++;
    if(!this.closedPaintPaths)return;
    if(this.closedPaintDirty.size){
      const added:WallDrawable[]=[];
      for(const id of this.closedPaintDirty)if(!this.openIds.has(id)){
        const keys=this.drawableKeys.get(id)??[];
        for(const key of keys){const line=this.drawable.get(key);if(line)added.push(line);}
        if(keys.length)this.closedPaintMembers.add(id);
      }
      added.sort((a,b)=>a.paintOrder-b.paintOrder);
      const compiled=this.compileTopPaths(added,dpr,true)!;
      const paths=new Map(this.closedPaintPaths.map(path=>[`${path.color}:${path.thickness}`,path]));
      for(const entry of compiled){const id=`${entry.color}:${entry.thickness}`,previous=paths.get(id);
        if(previous){previous.path.addPath(entry.path);previous.firstOrder=Math.min(previous.firstOrder,entry.firstOrder);previous.historical+=entry.historical;previous.current+=entry.current;}
        else paths.set(id,entry);
      }
      this.closedPaintPaths=[...paths.values()];this.closedPaintDirty.clear();this.stats.closedPaintCacheAppends++;
    }
    const open:WallDrawable[]=[];
    for(const id of this.openIds)for(const key of this.drawableKeys.get(id)??[]){const line=this.drawable.get(key);if(line)open.push(line);}
    open.sort((a,b)=>a.paintOrder-b.paintOrder);
    const dynamic=this.compileTopPaths(open,dpr,false);if(!dynamic)return;
    const paths=new Map<string,WallPaintBucket>();
    for(const entry of this.closedPaintPaths)paths.set(`${entry.color}:${entry.thickness}`,entry);
    for(const entry of dynamic){
      const id=`${entry.color}:${entry.thickness}`,closed=paths.get(id);
      if(!closed){paths.set(id,entry);continue;}
      const path=new Path2D();path.addPath(closed.path);path.addPath(entry.path);
      paths.set(id,{...entry,path,firstOrder:Math.min(closed.firstOrder,entry.firstOrder),historical:closed.historical+entry.historical,current:closed.current+entry.current});
    }
    const ordered=[...paths.values()].sort((a,b)=>a.firstOrder-b.firstOrder);
    this.stats.visibleHistorical=ordered.reduce((n,p)=>n+p.historical,0);this.stats.visibleCurrent=ordered.reduce((n,p)=>n+p.current,0);
    return ordered;
  }
  private compileTopPaths(lines:Iterable<WallDrawable>,dpr:number,closed:boolean):WallPaintBucket[]|undefined {
    const paths=new Map<string,WallPaintBucket>();
    let group:{line:WallDrawable;color:string;thickness:number;right:number;to:number;historical:number;current:number}|undefined;
    const flush=()=>{
      if(!group)return;
      const {line,color,thickness,right}=group,id=`${color}:${thickness}`;
      let bucket=paths.get(id);
      if(!bucket){bucket={color,thickness,path:new Path2D(),firstOrder:line.paintOrder,historical:0,current:0};paths.set(id,bucket);}
      bucket.historical+=group.historical;bucket.current+=group.current;
      bucket.path.moveTo(line.x*dpr,line.y*dpr);bucket.path.lineTo(right*dpr,line.y*dpr);group=undefined;
    };
    for(const line of lines){
      if(line.segment.detectionMode!=='top-levels')return;
      this.stats.paintStyleVisits++;if(closed)this.stats.closedPaintStyleVisits++;
      const {color,thickness}=this.lineStyle(line);
      const current=line.segment.currentSelection?1:0,historical=!current&&line.segment.archiveEntryId?1:0;
      const right=Math.max(line.x+1/dpr,line.right);
      if(group&&group.line.segment.id===line.segment.id&&group.line.segment.epoch===line.segment.epoch&&group.line.segment.side===line.segment.side&&group.color===color&&group.thickness===thickness&&group.to===line.from&&group.line.low===line.low&&group.line.high===line.high&&group.line.y===line.y&&line.x<=group.right){
        group.to=line.to;group.right=Math.max(group.right,right);group.historical+=historical;group.current+=current;continue;
      }
      flush();group={line,color,thickness,right,to:line.to,historical,current};
    }
    flush();return [...paths.values()];
  }
  private setDrawable(line:WallDrawable){
    const previous=this.drawable.get(line.key);line.paintOrder=previous?.paintOrder??this.nextPaintOrder++;
    if(previous&&previous.segment.detectionMode!=='top-levels')this.nonTopDrawables--;
    if(line.segment.detectionMode!=='top-levels')this.nonTopDrawables++;
    if(previous&&previous.segment.end!==null||!this.openIds.has(line.segment.id))this.changedClosedPaint(line.segment.id);
    this.drawable.set(line.key,line);
  }
  private deleteDrawable(key:string){
    const line=this.drawable.get(key);if(line&&line.segment.detectionMode!=='top-levels')this.nonTopDrawables--;
    if(line&&(line.segment.end!==null||!this.openIds.has(line.segment.id)||this.closedPaintMembers.has(line.segment.id)))this.changedClosedPaint(line.segment.id);this.drawable.delete(key);
  }
  private invalidateClosedPaint(){this.closedPaintInvalid=true;this.closedPaintPaths=undefined;this.paintPaths=undefined;this.closedPaintDirty.clear();}
  private changedClosedPaint(id:string){
    if(this.closedPaintMembers.has(id))this.invalidateClosedPaint();
    else if(!this.closedPaintInvalid)this.closedPaintDirty.add(id);
  }

  /** Presentation-only guides: never extend the recorded wall timeline itself. */
  private drawPriceLines(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){
    const active=new Map<string,WallDrawable>();
    // Guides belong only to open episodes. The retained closed drawable map
    // can contain a million exact value points; a current-tail update must not
    // traverse those points just to find the handful of live label anchors.
    for(const id of this.openIds){
      for(const key of this.drawableKeys.get(id)??[]){
        const line=this.drawable.get(key);if(!line)continue;
        const previous=active.get(id);
        if(!previous||line.from>previous.from)active.set(id,line);
      }
    }
    const dpr=rc.dpr,occupied:number[]=[];
    ctx.font=`${10*dpr}px ui-monospace, monospace`;ctx.textBaseline='middle';ctx.textAlign='right';
    // Strongest labels win crowded rows; guides stay aligned with actual wall prices.
    const lines=[...active.values()].map(line=>({line,segment:this.segments.get(line.segment.id)!})).sort((a,b)=>(b.segment.valueRuns.at(-1)?.usd??0)-(a.segment.valueRuns.at(-1)?.usd??0));
    for(const {line,segment} of lines){
      const value=orderWallValuePointAt(segment,Math.min(line.to,this.segmentTo(segment)));
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
      if(line){this.paintInvalid=true;this.setDrawable(line);this.drawableKeys.set(segment.id,[line.key]);}
    }
    if(segment.valueRuns.length){
      const range=rc.timeScale.visibleRange();
      const visibleFrom=rc.dataLayer.indexToTimeFloat(range.from)*1000,visibleTo=rc.dataLayer.indexToTimeFloat(range.to)*1000;
      const first=Math.max(0,lowerBoundRun(segment.valueRuns,visibleFrom)-1);
      const afterLast=Math.min(segment.valueRuns.length,Math.max(first+1,upperBoundRun(segment.valueRuns,visibleTo)));
      for(let index=first;index<afterLast;index++)this.projectIndex(segment,index,rc);
      return;
    }
    const to=this.segmentTo(segment);
    const line=this.project(segment,0,segment.start,to,null,rc);
    if(line){this.paintInvalid=true;this.setDrawable(line);this.drawableKeys.set(segment.id,[line.key]);}
  }
  private projectTail(segment:OrderWallSegment,fromIndex:number,rc:PrimitiveRenderContext){
    if(!segment.valueRuns.length){this.removeDrawables(segment.id);this.projectAll(segment,rc);return;}
    const keys=this.drawableKeys.get(segment.id)??[];
    for(const key of keys){const drawable=this.drawable.get(key);if(drawable&&drawable.runIndex>=fromIndex){this.paintInvalid=true;this.deleteDrawable(key);}}
    this.drawableKeys.set(segment.id,keys.filter(key=>this.drawable.has(key)));
    for(let i=fromIndex;i<segment.valueRuns.length;i++)this.projectIndex(segment,i,rc);
  }
  private removeDrawables(id:string){const keys=this.drawableKeys.get(id)??[];if(keys.length)this.paintInvalid=true;for(const key of keys)this.deleteDrawable(key);this.drawableKeys.delete(id);}
  private projectIndex(segment:OrderWallSegment,index:number,rc:PrimitiveRenderContext){
    const value=segment.valueRuns[index];if(!value)return;
    const next=segment.valueRuns[index+1],from=value.at,to=Math.min(next?.at??this.segmentTo(segment),this.segmentTo(segment));
    const line=this.project(segment,index,from,to,value.percentile,rc);if(!line)return;
    this.paintInvalid=true;this.setDrawable(line);const keys=this.drawableKeys.get(segment.id)??[];keys.push(line.key);this.drawableKeys.set(segment.id,keys);
  }
  private segmentTo(segment:OrderWallSegment){
    if(segment.end!==null)return segment.end;
    if(segment.currentSelection===true)return this.status.lastConfirmedAt??segment.start;
    if(segment.archiveEntryId){
      const segmentConfirmed=segment.start+Math.max(0,segment.durationMs);
      const archiveConfirmed=this.archivePaintThrough(this.status);
      return Math.max(segment.start,Math.min(segmentConfirmed,archiveConfirmed??segmentConfirmed));
    }
    return this.status.lastConfirmedAt??segment.start;
  }
  private project(segment:OrderWallSegment,runIndex:number,from:number,to:number,percentile:number|null,rc:PrimitiveRenderContext):WallDrawable|null{
    if(!this.settings.showHistory&&segment.end!==null||segment.durationMs<this.settings.minDurationMs)return null;
    from=Math.max(from,segment.start+this.settings.minDurationMs);
    // A current seed is an observed point, not an observed duration. Use the
    // existing one-pixel minimum stroke without extending its source time.
    if(to<from||to===from&&segment.currentSelection!==true)return null;
    const priceWidth=this.width(),low=segment.price,high=low+priceWidth;
    const range=rc.timeScale.visibleRange(),visibleFrom=rc.dataLayer.indexToTimeFloat(range.from)*1000,visibleTo=rc.dataLayer.indexToTimeFloat(range.to)*1000;
    if(to<visibleFrom||from>visibleTo)return null;
    const startLogical=wallTimestampToLogical(from,rc.dataLayer.timeToIndexFloat.bind(rc.dataLayer));
    const endLogical=wallTimestampToLogical(to,rc.dataLayer.timeToIndexFloat.bind(rc.dataLayer));
    if(startLogical===null||endLogical===null)return null;
    const x=rc.timeScale.indexToX(startLogical),right=rc.timeScale.indexToX(endLogical),y=rc.priceScale.priceToY(this.settings.aggregation==='native'?low:(low+high)/2);
    if(![x,right,y].every(Number.isFinite)||y<0||y>rc.plotHeight||right<0||x>rc.plotWidth)return null;
    const key=`${segment.id}@${from}`;
    return {key,segment,runIndex,from,to,percentile,usd:segment.valueRuns[runIndex]?.usd??null,x:Math.max(0,x),right:Math.min(rc.plotWidth,right),y,low,high,paintOrder:0};
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
    const at=best.from===best.to?best.from:Number.isFinite(projected)?projected!:best.from+(best.to-best.from)*ratio;
    const segment=this.segments.get(best.segment.id)??best.segment;
    return {segment,x,y,at,priceLow:best.low,priceHigh:best.high,percentile:orderWallValuePointAt(segment,at)?.percentile??null};
  }
  diagnostics(){const sorted=[...this.durations].sort((a,b)=>a-b);return {...this.stats,paintedViewport:this.paintedViewport?{...this.paintedViewport}:undefined,inputRevision:this.inputRevision,paintedRevision:this.paintedRevision,pendingProjectionSegments:this.dirty.size+this.tailDirty.size,retainedPaintPaths:this.paintPaths?.length??0,retainedClosedPaintPaths:this.closedPaintPaths?.length??0,retainedClosedPaintSegments:this.closedPaintMembers.size,pendingClosedPaintSegments:this.closedPaintDirty.size,retainedSegments:this.segments.size,openSegments:this.openIds.size,retainedReferenceSegments:this.referenceExtents.size,referenceExtentValues:this.referenceCounts.size,pendingReferenceSegments:this.referenceIds.size,referenceMinimum:this.reference.min,referenceMaximum:this.reference.max,retainedDrawables:this.drawable.size,p95RenderMs:sorted[Math.floor((sorted.length-1)*.95)]??0};}
  private measureOne(id:string){const before=this.sizes.get(id)??0,s=this.segments.get(id);const next=s?192+s.valueRuns.length*40:0;this.stats.bytes+=next-before;if(next)this.sizes.set(id,next);else this.sizes.delete(id);}
  private measureBytes(){this.stats.bytes=0;this.sizes.clear();for(const id of this.segments.keys())this.measureOne(id);this.referenceDirty=true;}
}

/** Vertical fit bounds for the currently active Top Levels selections. */
export function orderWallsFitRange(segments: readonly OrderWallSegment[], tickSize = 0.01, hasCurrentLiveSelection = false) {
  if (!hasCurrentLiveSelection) return null;
  const prices = segments.filter(segment => segment.currentSelection === true && segment.end === null && segment.detectionMode === 'top-levels'
    && Number.isFinite(segment.price) && segment.price > 0).map(segment => segment.price);
  if (!prices.length) return null;
  const low = Math.min(...prices), high = Math.max(...prices);
  const padding = Math.max((high - low) * 0.08, ((high + low) / 2) * 0.001, (Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01) * 4);
  return { min: Math.max(Number.MIN_VALUE, low - padding), max: high + padding };
}

function isArchiveSegment(segment:OrderWallSegment){return typeof segment.archiveEntryId==='string'&&segment.archiveEntryId.length>0;}

function lowerBoundRun(runs:OrderWallSegment['valueRuns'],at:number){
  let low=0,high=runs.length;
  while(low<high){const mid=(low+high)>>>1;if(runs[mid]!.at<at)low=mid+1;else high=mid;}
  return low;
}
function upperBoundRun(runs:OrderWallSegment['valueRuns'],at:number){
  let low=0,high=runs.length;
  while(low<high){const mid=(low+high)>>>1;if(runs[mid]!.at<=at)low=mid+1;else high=mid;}
  return low;
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

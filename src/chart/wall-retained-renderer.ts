import type {PrimitiveRenderContext} from 'openalgo-charts';
import type {OrderWallSegment,OrderWallsSettings,OrderWallHit} from '../feed/order-walls';
import {orderWallValuePointAt} from '../feed/order-walls';
import {acquireWallGpu,WallGpuBatch,WALL_GPU_BATCH_RUNS,type WallRenderSpan,type WallRenderStyle} from './wall-gpu-resources';

interface Piece {id:string;first:number;last:number;chunk:Chunk}
type Layer='history'|'current';
interface Chunk {layer:Layer;pieces:Set<Piece>;slots:number;batch?:WallGpuBatch}
interface Source {layer:Layer;segment:OrderWallSegment;startAt:number;endAt:number;count:number;pieces:Piece[]}
const PALETTES={heat:{bid:['#33778c','#45bcd0','#f1cb59','#ff884d'],ask:['#666da5','#8b99eb','#e9c15b','#ff8766']},side:{bid:['#28644b','#3d9970','#66d39a','#b6f1aa'],ask:['#7b3f4b','#bf6273','#ed9a9e','#ffd0b0']}};

/** Exact source ownership is separate from immutable batch resources and the
 * current camera. Only affected bounded chunks are rebuilt after source edits.
 * Removal/correction masks affected instances before any next paint; unaffected
 * instances in that same chunk remain available until atomic replacement. */
export class RetainedWallRenderer {
  private readonly owner:NonNullable<ReturnType<typeof acquireWallGpu>>;
  private readonly sources=new Map<string,Source>();
  private readonly chunks=new Set<Chunk>();
  private readonly dirty=new Set<Chunk>();
  private readonly tails=new Map<Layer,Chunk>();
  private context?:PrimitiveRenderContext;
  private paintedCamera='';
  private geometryKey='';
  private disposed=false;
  readonly stats={builds:0,historyBuilds:0,currentBuilds:0,frames:0,mappingInvalidations:0,uploadedBytes:0,bufferUploads:0,drawCalls:0,maxPrepareMs:0,lastPrepareMs:0,lastPaintMs:0,visibleSpans:0,visibleHistorical:0,visibleCurrent:0,bytes:0,referenceMin:0,referenceMax:0,failure:''};
  private constructor(owner:NonNullable<ReturnType<typeof acquireWallGpu>>,private readonly end:(segment:OrderWallSegment)=>number,private readonly invalidate:()=>void,private readonly start:(segment:OrderWallSegment)=>number){this.owner=owner;}
  static create(end:(segment:OrderWallSegment)=>number,invalidate:()=>void,start:(segment:OrderWallSegment)=>number=()=>-Infinity){const owner=acquireWallGpu(invalidate);return owner?new RetainedWallRenderer(owner,end,invalidate,start):undefined;}
  get pending(){return this.dirty.size;}
  get active(){return Boolean(this.context)&&!this.owner.device.lost;}
  get retainedSpans(){let count=0;for(const chunk of this.chunks)count+=chunk.batch?.spans.length??0;return count;}
  diagnostics(){return {...this.stats,pending:this.pending,chunks:this.chunks.size,sources:this.sources.size,retainedSpans:this.retainedSpans,contextLost:this.owner.device.lost,sharedGpuBytes:this.owner.device.bytes,sharedOwners:this.owner.device.owners};}
  dispose(){if(this.disposed)return;this.disposed=true;for(const chunk of this.chunks)chunk.batch?.dispose();this.chunks.clear();this.dirty.clear();this.sources.clear();this.tails.clear();this.context=undefined;this.owner.release();this.stats.bytes=0;}

  reconcile(segments:ReadonlyMap<string,OrderWallSegment>){
    for(const id of this.sources.keys())if(!segments.has(id))this.remove(id);
    for(const segment of segments.values()){
      const prior=this.sources.get(segment.id),previous=prior?.segment;
      if(prior&&previous===segment&&prior.endAt===this.end(segment)&&prior.startAt===this.start(segment))continue;
      // Presentation snapshots can replace objects without changing financial
      // content. Compare on data arrival, never during a camera frame.
      if(previous&&sameSegment(previous,segment)&&this.sameOwnedGeometry(prior!,segment)){
        if(prior!.startAt!==this.start(segment))this.change(segment,-1);
        else if(prior!.endAt!==this.end(segment))this.change(segment,Math.max(0,segment.valueRuns.length-1));
        else prior!.segment=segment;
        continue;
      }
      this.change(segment,-1);
    }
  }
  private sameOwnedGeometry(source:Source,next:OrderWallSegment){
    const a=source.segment.residentRange,b=next.residentRange;
    if(a?.from===b?.from&&a?.to===b?.to)return true;
    // Adopting an already-fenced completed presentation need not blank/rebuild
    // its existing geometry. Only reuse when every built span fits the owner.
    if(!b||source.pieces.some(piece=>!piece.chunk.batch||this.dirty.has(piece.chunk)))return false;
    return source.pieces.every(piece=>piece.chunk.batch!.spans.every(span=>span.id!==next.id||span.from>=b.from&&span.to<b.to));
  }
  remove(id:string){const source=this.sources.get(id);if(!source)return;
    for(const piece of source.pieces){const chunk=piece.chunk;chunk.batch?.hide(id);chunk.pieces.delete(piece);chunk.slots-=piece.last-piece.first;
      if(!chunk.pieces.size){chunk.batch?.dispose();this.chunks.delete(chunk);this.dirty.delete(chunk);if(this.tails.get(chunk.layer)===chunk)this.tails.delete(chunk.layer);}else this.dirty.add(chunk);}
    this.sources.delete(id);
  }
  refreshHorizon(segment:OrderWallSegment){
    const source=this.sources.get(segment.id);if(!source)return;
    if(source.startAt!==this.start(segment))this.change(segment,-1);
    else if(source.endAt!==this.end(segment))this.change(segment,Math.max(0,segment.valueRuns.length-1));
  }
  change(segment:OrderWallSegment,firstChanged= -1){
    const layer:Layer=segment.currentSelection||segment.presentationKind==='current-snapshot'?'current':'history';
    let source=this.sources.get(segment.id);
    if(source&&source.layer!==layer){this.remove(segment.id);source=undefined;}
    if(source&&firstChanged<0&&sameSegment(source.segment,segment)&&source.endAt===this.end(segment)&&source.startAt===this.start(segment)&&this.sameOwnedGeometry(source,segment)){source.segment=segment;return;}
    const count=Math.max(1,segment.valueRuns.length)+1;
    if(!source){source={layer,segment,startAt:this.start(segment),endAt:this.end(segment),count:0,pieces:[]};this.sources.set(segment.id,source);}else source.segment=segment;
    for(const piece of [...source.pieces]){
      if(piece.last-1<firstChanged+1&&piece.last<=count)continue;
      piece.chunk.batch?.hide(segment.id,firstChanged);
      this.dirty.add(piece.chunk);
      if(piece.first>=count){piece.chunk.pieces.delete(piece);piece.chunk.slots-=piece.last-piece.first;source.pieces.splice(source.pieces.indexOf(piece),1);
        if(!piece.chunk.pieces.size){piece.chunk.batch?.dispose();this.chunks.delete(piece.chunk);this.dirty.delete(piece.chunk);if(this.tails.get(piece.chunk.layer)===piece.chunk)this.tails.delete(piece.chunk.layer);}}
      else if(piece.last>count){piece.chunk.slots-=piece.last-count;piece.last=count;}
    }
    let next=Math.min(source.count,count);
    while(next<count){
      let tail=this.tails.get(layer);
      if(!tail||tail.slots>=WALL_GPU_BATCH_RUNS){tail={layer,pieces:new Set(),slots:0};this.tails.set(layer,tail);this.chunks.add(tail);}
      const last=Math.min(count,next+WALL_GPU_BATCH_RUNS-tail.slots),piece={id:segment.id,first:next,last,chunk:tail};
      tail.pieces.add(piece);tail.slots+=last-next;this.dirty.add(tail);source.pieces.push(piece);next=last;
    }
    source.count=count;source.startAt=this.start(segment);source.endAt=this.end(segment);
  }
  private spans(chunk:Chunk,settings:OrderWallsSettings,width:number):WallRenderSpan[]{
    const result:WallRenderSpan[]=[];
    for(const piece of chunk.pieces){const source=this.sources.get(piece.id);if(!source)continue;const s=source.segment;
      if(!settings.showHistory&&s.end!==null||s.presentationKind!=='current-snapshot'&&s.durationMs<settings.minDurationMs)continue;
      const limit=this.end(s),minimum=Math.max(this.start(s),s.start+(s.presentationKind==='current-snapshot'?0:settings.minDurationMs)),price=settings.aggregation==='native'?s.price:s.price+width/2;
      for(let at=piece.first;at<piece.last;at++){
        const i=at-1,run=s.valueRuns[i];let from:number,to:number,usd:number|null;
        if(i===-1){if(!s.valueRunsTruncated||!s.valueRuns[0]||s.valueRuns[0].at<=minimum)continue;from=minimum;to=Math.min(limit,s.valueRuns[0].at);usd=null;}
        else if(!s.valueRuns.length&&i===0){from=minimum;to=limit;usd=null;}
        else if(run){from=Math.max(minimum,run.at);to=Math.min(limit,s.valueRuns[i+1]?.at??limit);usd=run.usd;}
        else continue;
        if(to<from||to===from&&!s.currentSelection)continue;
        result.push({id:s.id,runIndex:i,from,to,price,usd,side:s.side,current:s.currentSelection===true,historical:!s.currentSelection&&Boolean(s.archiveEntryId)});
      }
    }
    return result;
  }
  draw(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext,settings:OrderWallsSettings,width:number,budgetMs=6){
    if(this.disposed||this.owner.device.lost){this.stats.failure='context-lost';return false;}
    const key=[settings.minDurationMs,settings.showHistory,settings.aggregation,width].join(':');
    if(key!==this.geometryKey){this.geometryKey=key;for(const source of this.sources.values())this.change(source.segment,-1);}
    const device=this.owner.device,uploadsBefore=device.uploads,bytesBefore=device.uploadedBytes,started=performance.now();
    // Candle insertions/corrections are real mapping revisions. Ordinary camera
    // motion and an unchanged mapping translated by prepended candles are not.
    const cameras=new Map<Chunk,ReturnType<WallGpuBatch['camera']>>();
    for(const chunk of this.chunks)if(chunk.batch){const camera=chunk.batch.camera(rc);if(!camera){chunk.batch.dispose();chunk.batch=undefined;this.dirty.add(chunk);this.stats.mappingInvalidations++;}else cameras.set(chunk,camera);}
    let turns=0;
    // A delayed current bootstrap must not sit behind a large history import.
    // Work remains bounded by the same per-frame turn/time allowance.
    const work=[...this.dirty];
    for(const chunk of [...work.filter(chunk=>chunk.layer==='current'),...work.filter(chunk=>chunk.layer==='history')]){
      const spans=this.spans(chunk,settings,width);
      const next=spans.length?WallGpuBatch.prepare(rc,spans,device):undefined;
      if(spans.length&&!next){this.stats.failure='mapping-or-render-capacity';return false;}
      chunk.batch?.dispose();chunk.batch=next;this.dirty.delete(chunk);this.stats.builds++;this.stats[chunk.layer==='history'?'historyBuilds':'currentBuilds']++;if(next)cameras.set(chunk,next.camera(rc));
      if(++turns>=4||performance.now()-started>=Math.max(1,budgetMs))break;
    }
    this.stats.lastPrepareMs=performance.now()-started;this.stats.maxPrepareMs=Math.max(this.stats.maxPrepareMs,this.stats.lastPrepareMs);
    const range=rc.timeScale.visibleRange(),from=rc.dataLayer.indexToTimeFloat(range.from)*1000,to=rc.dataLayer.indexToTimeFloat(range.to)*1000;
    const p0=rc.priceScale.yToPrice(0),p1=rc.priceScale.yToPrice(rc.plotHeight),low=Math.min(p0,p1),high=Math.max(p0,p1);
    let min=Infinity,max=0;
    for(const chunk of this.chunks)if(chunk.batch){const extent=chunk.batch.extent(settings.visibleRangeOnly?from:-Infinity,settings.visibleRangeOnly?to:Infinity,settings.visibleRangeOnly?low:-Infinity,settings.visibleRangeOnly?high:Infinity);min=Math.min(min,extent.min);max=Math.max(max,extent.max);}
    const palette=settings.colorMode==='heat'?PALETTES.heat:PALETTES.side;
    const style:WallRenderStyle={min:Number.isFinite(min)?min:0,max,highContrast:settings.highContrast,strengthThickness:settings.strengthThickness,thickness:settings.thicknessPx,opacity:settings.opacity,...palette};
    this.stats.referenceMin=style.min;this.stats.referenceMax=max;
    const paint=performance.now();if(!device.begin(Math.round(rc.plotWidth*rc.dpr),Math.round(rc.plotHeight*rc.dpr))){this.stats.failure='render-surface-capacity';return false;}
    let draws=0,visible=0,historical=0,current=0,bytes=0;
    for(const chunk of this.chunks)if(chunk.batch){const batch=chunk.batch;
      if(!batch.paint(rc,style,cameras.get(chunk))){this.stats.failure='mapping-changed';return false;}draws++;bytes+=batch.bytes+batch.mapping.bytes+batch.values.length*8;
      for(let i=0;i<batch.spans.length;i++){const span=batch.spans[i]!;if(batch.enabled[i]&&span.to>=from&&span.from<=to&&span.price>=low&&span.price<=high){visible++;if(span.current)current++;if(span.historical)historical++;}}}
    ctx.save();ctx.beginPath();ctx.rect(0,0,rc.plotWidth*rc.dpr,rc.plotHeight*rc.dpr);ctx.clip();ctx.globalAlpha=1;ctx.drawImage(device.canvas,0,0);ctx.restore();this.context=rc;this.paintedCamera=cameraIdentity(rc);
    this.stats.frames++;this.stats.drawCalls=draws;this.stats.visibleSpans=visible;this.stats.visibleCurrent=current;this.stats.visibleHistorical=historical;this.stats.bytes=bytes;this.stats.failure='';this.stats.lastPaintMs=performance.now()-paint;
    this.stats.bufferUploads+=device.uploads-uploadsBefore;this.stats.uploadedBytes+=device.uploadedBytes-bytesBefore;
    if(this.dirty.size)this.invalidate();return true;
  }
  hit(x:number,y:number,width:number,settings:OrderWallsSettings):OrderWallHit|null{
    const rc=this.context;if(!rc||this.paintedCamera!==cameraIdentity(rc)||x<0||x>rc.plotWidth||y<0||y>rc.plotHeight)return null;
    const at=rc.dataLayer.indexToTimeFloat(rc.timeScale.xToIndex(x))*1000,earliest=rc.dataLayer.indexToTimeFloat(rc.timeScale.xToIndex(x-1/rc.dpr))*1000;let best:OrderWallHit|null=null,distance=Math.max(4,settings.thicknessPx/2+2);
    for(const chunk of this.chunks){const batch=chunk.batch;if(!batch||batch.mapping.offset(rc)===undefined)continue;
      for(let i=0;i<batch.spans.length;i++){const span=batch.spans[i]!;if(!batch.enabled[i]||at<span.from||earliest>span.to)continue;
        const left=rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(span.from/1000)),right=Math.max(left+1/rc.dpr,rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(span.to/1000)));if(x<left||x>right)continue;
        const dy=Math.abs(rc.priceScale.priceToY(span.price)-y),segment=this.sources.get(span.id)?.segment;
        if(segment&&dy<=distance){distance=dy;best={segment,x,y,at:Math.min(span.to,at),priceLow:segment.price,priceHigh:segment.price+width,percentile:orderWallValuePointAt(segment,at)?.percentile??null};}
      }
    }return best;
  }
}
function sameSegment(a:OrderWallSegment,b:OrderWallSegment){
  if(a.price!==b.price||a.start!==b.start||a.end!==b.end||a.durationMs!==b.durationMs||a.side!==b.side||a.currentSelection!==b.currentSelection||a.presentationKind!==b.presentationKind||a.valueRunsTruncated!==b.valueRunsTruncated||a.valueRuns.length!==b.valueRuns.length)return false;
  if(a.valueRuns===b.valueRuns)return true;
  return a.valueRuns.every((run,i)=>{const next=b.valueRuns[i]!;return run.at===next.at&&run.usd===next.usd&&run.quantity===next.quantity&&run.rank===next.rank&&run.percentile===next.percentile;});
}

function cameraIdentity(rc:PrimitiveRenderContext){
 const prices=rc.priceScale.priceRange();
 return [rc.timeScale.indexToX(0),rc.timeScale.indexToX(1),prices.min,prices.max,rc.priceScale.priceToY(prices.min),rc.priceScale.priceToY(prices.max),rc.priceScale.options?.mode,rc.plotWidth,rc.plotHeight,rc.dpr].join(':');
}

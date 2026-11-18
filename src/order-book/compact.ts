import {formatDepthMatrixCellValue,smoothDepthMatrixScale,type MatrixRow} from '../feed/depth-matrix';
import {matrixExactPrice,type MatrixRowLayout} from '../depth-matrix-presentation';
import {displayedBalance,type BookRow,type BookSide,type OrderBookProjection} from './projection';
import {barPieces,pieceAt,pieceLabel,sourceMark,TextMeasurements,LiquidityRanking,type BarPiece} from './pieces';
import type {OrderBookSettings} from './settings';
const FONT='10px ui-monospace,SFMono-Regular,Menlo,monospace';
export const COMPACT_GUTTER=116;
interface HitRow {row:BookRow;top:number;height:number;side:'bid'|'ask';pieces:BarPiece[]}
export interface CompactPalette {background:string;text:string;muted:string;divider:string;bid:string;ask:string;accent:string;light:boolean}
/** Canvas presentation only; source normalization, sums and cumulative proofs arrive from the worker. */
export class CompactOrderBook {
 private text=new TextMeasurements();private ranking=new LiquidityRanking();private hits:HitRow[]=[];
 private scale=0;private cumulativeScale=0;private venueScale=0;private scaleAt=0;private projection?:OrderBookProjection;
 private ranked:string[]=[];
 paint(canvas:HTMLCanvasElement,projection:OrderBookProjection|undefined,rows:readonly MatrixRow[],layout:MatrixRowLayout,
  first:number,last:number,width:number,settings:OrderBookSettings,p:CompactPalette,now=performance.now()){
  this.hits=[];this.projection=projection;if(!projection||!rows.length){canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);return {label:projection?.sources.length===0?'No selected sources':'Waiting for depth',balance:displayedBalance([]),lines:[] as string[]};}
  const map=new Map(projection.rows.map(row=>[row.index,row])),visible=rows.slice(first,last).map(r=>map.get(r.index)).filter((r):r is BookRow=>!!r);
  const target=Math.max(0,...visible.flatMap(r=>[r.bid.notional,r.ask.notional]));
  this.scale=smoothDepthMatrixScale(target,this.scale,Math.max(0,now-this.scaleAt));this.scaleAt=now;
  this.cumulativeScale=Math.max(0,...visible.flatMap(r=>[r.bid.cumulative?.notional??0,r.ask.cumulative?.notional??0]));
  this.ranked=this.ranking.apply(now,projection.liveSources,settings.compact.venueLines,id=>visible.reduce((sum,r)=>sum+[r.bid,r.ask].reduce((s,side)=>s+(side.contributions.find(c=>c.source===id&&c.live)?.notional??0),0),0));
  this.venueScale=Math.max(0,...visible.flatMap(r=>[r.bid,r.ask].flatMap(side=>side.contributions.filter(c=>c.live&&this.ranked.includes(c.source)&&c.cumulative?.coverage!=='unknown').map(c=>c.cumulative?.notional??0))));
  const dpr=Math.max(1,Math.min(2,devicePixelRatio||1)),height=Math.max(1,layout.height);
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
  canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
  const ctx=canvas.getContext('2d');if(!ctx)return {label:'Canvas unavailable',balance:displayedBalance([]),lines:[] as string[]};
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.font=FONT;ctx.textBaseline='middle';
  const start=layout.positions[first]?.top??0,end=last?layout.positions[last-1]!.top+layout.positions[last-1]!.height:start;
  ctx.fillStyle=p.background;ctx.fillRect(0,start,width,end-start);
  const barX=COMPACT_GUTTER,barW=Math.max(1,width-barX-5),origin=projection.anchor?projection.rows.find(r=>Number(r.low)<=Number(projection.anchor!.price)&&Number(r.high)>Number(projection.anchor!.price))?.index:undefined;
  const labels:{text:string;x:number;y:number}[]=[];
  const measure=(text:string)=>this.text.measure(FONT,text,t=>ctx.measureText(t).width);
  const band=(side:BookSide,type:'bid'|'ask',row:BookRow,y:number,h:number)=>{
   const color=type==='bid'?p.bid:p.ask,cum=side.cumulative;
   if(settings.compact.show!=='levels'&&cum&&cum.coverage!=='unknown'&&this.cumulativeScale>0){
    const w=Math.min(barW,cum.notional/this.cumulativeScale*barW);
    ctx.fillStyle=color;ctx.globalAlpha=.10;ctx.fillRect(barX,y,w,h);ctx.globalAlpha=1;
   }
   if(settings.compact.show!=='cumulative'){
    const values=side.contributions.map(c=>c.live&&(c.coverage==='observed'||c.coverage==='partial')?c.notional:0);
    const pieces=barPieces(projection.sources,values,this.scale,barX,barW);
    for(const piece of pieces){
     ctx.fillStyle=color;ctx.globalAlpha=piece.rank%2===0?.35:.22;ctx.fillRect(piece.x,y+2,Math.max(0,piece.width-.5),Math.max(1,h-4));ctx.globalAlpha=1;
     const mark=piece.id?sourceMark(piece.id):null;ctx.strokeStyle=mark?(p.light?mark.light:mark.dark):p.muted;
     ctx.beginPath();ctx.moveTo(piece.x,y+2);ctx.lineTo(piece.x+Math.max(0,piece.width-.5),y+2);ctx.stroke();
     const label=pieceLabel(mark?.name??'Other',mark?.code??'Other',formatDepthMatrixCellValue(piece.notional,'usdt'),piece.width,measure);
     if(label)labels.push({text:label,x:piece.x+3,y:y+h/2});
    }
    // Retain disconnected values as outlined ghosts; they never enter live sums or scales.
    const retained=side.contributions.filter(c=>!c.live&&c.notional>0).reduce((s,c)=>s+c.notional,0);
    if(retained>0){ctx.save();ctx.strokeStyle=p.muted;ctx.setLineDash([2,3]);ctx.strokeRect(barX+.5,y+2,Math.min(barW,retained/Math.max(this.scale,retained)*barW),Math.max(1,h-4));ctx.restore();}
    this.hits.push({row,top:y,height:h,side:type,pieces});
   }else this.hits.push({row,top:y,height:h,side:type,pieces:[]});
  };
  const gridPath=new Path2D();
  for(let i=first;i<last;i++){
   const base=rows[i]!,row=map.get(base.index);if(!row)continue;const pos=layout.positions[i]!,y=pos.top,h=pos.height;
   const bidPresent=row.bid.contributions.some(c=>c.quantity>0),askPresent=row.ask.contributions.some(c=>c.quantity>0);
   const mixed=bidPresent&&askPresent,side: 'bid'|'ask'=bidPresent?'bid':askPresent?'ask':projection.anchor&&Number(row.low)>Number(projection.anchor.price)?'ask':'bid';
   if(row.index===origin){ctx.fillStyle=p.accent;ctx.globalAlpha=.09;ctx.fillRect(0,y,width,h);ctx.globalAlpha=1;}
   gridPath.moveTo(0,y+h-.5);gridPath.lineTo(width,y+h-.5);
   ctx.fillStyle=row.index===origin?p.accent:p.text;ctx.textAlign='right';ctx.fillText(matrixExactPrice(row.low),63,y+h/2,61);
   if(mixed){band(row.ask,'ask',row,y,h/2);band(row.bid,'bid',row,y+h/2,h/2);}
   else band(row[side],side,row,y,h);
   const writeAmount=(s:BookSide,y0:number)=>{ctx.fillStyle=s.coverage==='unknown'?p.muted:p.text;ctx.textAlign='right';ctx.fillText(s.coverage==='unknown'?'—':(s.coverage==='lower-bound'?'≥':'')+formatDepthMatrixCellValue(s.notional,'usdt'),barX-6,y0,46);};
   if(mixed){writeAmount(row.ask,y+h/4);writeAmount(row.bid,y+3*h/4);}else writeAmount(row[side],y+h/2);
  }
  ctx.strokeStyle=p.divider;ctx.lineWidth=1;ctx.stroke(gridPath);
  // Independent stepped axes. A missing proof stops a curve; partial coverage is dashed.
  if(settings.compact.show!=='levels'){
   const curve=(side:'bid'|'ask',source:string|null,full:number,color:string)=>{
    if(full<=0)return;
    // Batch by coverage style: one stroke per style, rather than save/stroke/restore
    // for every row. Missing proof still breaks continuity at that row.
    const paths={exact:new Path2D(),partial:new Path2D()};
    let previous:{x:number;bottom:number}|undefined;
    for(let i=first;i<last;i++){
     const row=map.get(rows[i]!.index),pos=layout.positions[i]!;if(!row){previous=undefined;continue;}
     const contribution=source?row[side].contributions.find(c=>c.source===source&&c.live):null;
     const value=source?contribution?.cumulative:row[side].cumulative;
     if(!value||value.coverage==='unknown'||value.coverage==='stale'){previous=undefined;continue;}
     const x=barX+Math.min(1,value.notional/full)*barW,path=value.coverage==='exact'?paths.exact:paths.partial;
     if(previous&&previous.bottom===pos.top){path.moveTo(previous.x,pos.top);path.lineTo(x,pos.top);}else path.moveTo(x,pos.top);
     path.lineTo(x,pos.top+pos.height);previous={x,bottom:pos.top+pos.height};
    }
    ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=source?.7:.55;ctx.lineWidth=source?1:1.25;
    ctx.setLineDash([]);ctx.stroke(paths.exact);ctx.setLineDash([3,3]);ctx.stroke(paths.partial);ctx.restore();
   };
   for(const side of ['bid','ask'] as const){curve(side,null,this.cumulativeScale,side==='bid'?p.bid:p.ask);for(const source of this.ranked){const mark=sourceMark(source);curve(side,source,this.venueScale,p.light?mark.light:mark.dark);}}
  }
  ctx.fillStyle=p.text;ctx.textAlign='left';for(const label of labels)ctx.fillText(label.text,label.x,label.y);
  ctx.strokeStyle=p.divider;ctx.beginPath();ctx.moveTo(67,start);ctx.lineTo(67,end);ctx.moveTo(barX-2,start);ctx.lineTo(barX-2,end);ctx.stroke();
  const label=`Level ${formatDepthMatrixCellValue(this.scale,'usdt')} · Σ ${formatDepthMatrixCellValue(this.cumulativeScale,'usdt')} · Lines ${formatDepthMatrixCellValue(this.venueScale,'usdt')} USDT/full width`;
  return {label,balance:displayedBalance(visible),lines:this.ranked};
 }
 tooltip(x:number,y:number){
  const hit=this.hits.find(h=>y>=h.top&&y<h.top+h.height);if(!hit)return '';
  const side=hit.row[hit.side],piece=pieceAt(hit.pieces,x),selected=piece?.id?[piece.id]:piece?piece.merged.map(m=>m.id):side.contributions.map(c=>c.source);
  const amounts=side.contributions.filter(c=>selected.includes(c.source));
  const coverage=(c:string)=>c==='lower-bound'?'incomplete lower bound':c;
  const cumulative=side.cumulative;
  return [`${hit.row.low} ≤ price < ${hit.row.high} USDT · ${hit.side.toUpperCase()}`,
   piece?.id?sourceMark(piece.id).name:piece?'Other — merged contributors':'Selected sources',
   ...amounts.map(c=>`${sourceMark(c.source).code}: ${c.quantity} BTC · ${c.notional} USDT · ${c.live?'live':'retained / excluded'} · ${c.coverage} · age ${c.ageMs===null?'unknown':(c.ageMs/1000).toFixed(2)+'s'} · cursor ${c.cursor} / epoch ${c.epoch} · cumulative ${c.cumulative&&c.cumulative.coverage!=='unknown'?c.cumulative.notional+' USDT ('+c.cumulative.coverage+')':'unavailable'}`),
   `Live aggregate: ${side.coverage==='unknown'?'unavailable':side.notional+' USDT · '+coverage(side.coverage)}`,
   `Cumulative: ${!cumulative||cumulative.coverage==='unknown'?'unavailable':cumulative.notional+' USDT · '+coverage(cumulative.coverage)}`,
   `Origin: ${this.projection?.anchor?sourceMark(this.projection.anchor.source).code+' @ '+this.projection.anchor.price+' USDT (pinned)':'waiting for live reference'}`,
   `Level full width: ${this.scale} USDT · immediate rise, 5s decay`,
   `Cumulative full width: ${this.cumulativeScale} USDT · venue lines: ${this.venueScale} USDT`,
   'Lines: Top N by displayed live liquidity; ranking held 30s. Dashed = incomplete lower bound.'].join('\n');
 }
 diagnostics(){return {levelScale:this.scale,cumulativeScale:this.cumulativeScale,venueScale:this.venueScale,ranked:[...this.ranked],textMeasurements:this.text.size};}
 dispose(){this.hits=[];this.text.clear();this.projection=undefined;}
}

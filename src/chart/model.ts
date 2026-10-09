import { type Candle } from '../feed/protocol';
import { MAX_BARS } from '../feed/reconcile';
export interface Change { first: number; last: number; structural: boolean; removed: number; added: number }
export class CandleStore {
  readonly time = new Float64Array(MAX_BARS + 128);
  readonly open = new Float64Array(MAX_BARS + 128);
  readonly high = new Float64Array(MAX_BARS + 128);
  readonly low = new Float64Array(MAX_BARS + 128);
  readonly close = new Float64Array(MAX_BARS + 128);
  readonly volume = new Float64Array(MAX_BARS + 128);
  length = 0;
  private columns() { return [this.time,this.open,this.high,this.low,this.close,this.volume]; }
  find(t: number) { let a=0,b=this.length; while(a<b) { const m=(a+b)>>>1; if(this.time[m]<t)a=m+1;else b=m; } return a; }
  at(i: number): Candle { return {t:this.time[i],o:this.open[i],h:this.high[i],l:this.low[i],c:this.close[i],v:this.volume[i],revision:0,closed:false}; }
  reset(bars: Candle[]) { this.length=0; return this.patch(bars.slice(-MAX_BARS)); }
  patch(bars: Candle[]): Change {
    let first=Infinity,last=-1,structural=false,added=0,removed=0;
    for(const b of bars) {
      const i=this.find(b.t);
      if(i===this.length || this.time[i]!==b.t) {
        if(this.length===this.time.length) { this.prune(128); removed+=128; }
        const j=this.find(b.t);
        for(const col of this.columns()) col.copyWithin(j+1,j,this.length);
        this.length++;added++;structural=true;
        this.write(j,b);first=Math.min(first,j);last=Math.max(last,j);
      } else { this.write(i,b);first=Math.min(first,i);last=Math.max(last,i); }
    }
    if(this.length>MAX_BARS) { const n=Math.max(128,this.length-MAX_BARS);this.prune(n);removed+=n;structural=true; }
    return {first,last,structural,added,removed};
  }
  private write(i:number,b:Candle) { this.time[i]=b.t;this.open[i]=b.o;this.high[i]=b.h;this.low[i]=b.l;this.close[i]=b.c;this.volume[i]=b.v; }
  private prune(n:number) { for(const c of this.columns())c.copyWithin(0,n,this.length);this.length-=n; }
}
export interface Rect { x:number;y:number;width:number;height:number }
export class Viewport {
  spacing=7; right=0; following=true;
  plot:Rect={x:0,y:0,width:1,height:1}; min=0;max=1;
  resize(width:number,height:number) { this.plot={x:8,y:12,width:Math.max(1,width-88),height:Math.max(1,height-43)}; }
  latest(length:number) { this.right=Math.max(0,length-1)+5;this.following=true; }
  x(index:number) { return this.plot.x+this.plot.width-(this.right-index)*this.spacing; }
  index(x:number) { return this.right-(this.plot.x+this.plot.width-x)/this.spacing; }
  y(price:number) { return this.plot.y+(this.max-price)/(this.max-this.min)*this.plot.height; }
  price(y:number) { return this.max-(y-this.plot.y)/this.plot.height*(this.max-this.min); }
  range(length:number,margin=2) { return {start:Math.max(0,Math.floor(this.index(this.plot.x))-margin),end:Math.min(length,Math.ceil(this.right)+margin+1)}; }
  zoom(x:number,factor:number) { const i=this.index(x);this.spacing=Math.max(3,Math.min(40,this.spacing*factor));this.right=i+(this.plot.x+this.plot.width-x)/this.spacing;this.following=false; }
  pan(dx:number,length:number) { this.right=Math.max(0,Math.min(length+this.plot.width/this.spacing*.7,this.right-dx/this.spacing));this.following=false; }
  autoscale(s:CandleStore) {
    const r=this.range(s.length,0);let min=Infinity,max=-Infinity;
    for(let i=r.start;i<r.end;i++) { min=Math.min(min,s.low[i]);max=Math.max(max,s.high[i]); }
    if(!Number.isFinite(min)) { min=0;max=1; }
    const pad=Math.max((max-min)*.08,Math.abs(max)*.00005,.01);this.min=min-pad;this.max=max+pad;
  }
}
// Two rectangles per candle: one wick, one body, CSS pixel coordinates.
export function candleGeometry(s:CandleStore,v:Viewport,i:number): number[] {
  const x=v.x(i),yo=v.y(s.open[i]),yc=v.y(s.close[i]),yh=v.y(s.high[i]),yl=v.y(s.low[i]);
  const color=s.close[i]>=s.open[i]?1:0,w=Math.max(1,Math.floor(v.spacing*.68));
  return [x-.5,yh,1,Math.max(1,yl-yh),color, x-w/2,Math.min(yo,yc),w,Math.max(1,Math.abs(yo-yc)),color];
}

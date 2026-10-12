import type {IPrimitive,PrimitiveHost,PrimitiveRenderContext} from 'openalgo-charts';
import type {LevelWatch} from '../level-watch/types';
/** Display-only fixed zones. No autoscale contribution or evaluator ownership. */
export class WatchZones implements IPrimitive {
  private host?:PrimitiveHost;private watches:LevelWatch[]=[];private key='';
  zOrder(){return 'top' as const;}
  attached(host:PrimitiveHost){this.host=host;}
  detached(){this.host=undefined;this.watches=[];}
  set(watches:LevelWatch[]){const selected=watches.filter(w=>w.state==='armed'||w.state==='draft').slice(0,10);const key=JSON.stringify(selected.map(w=>[w.id,w.definition,w.state,w.quality]));if(key===this.key)return;this.key=key;this.watches=selected;this.host?.requestUpdate();}
  draw(ctx:CanvasRenderingContext2D,rc:PrimitiveRenderContext){const dpr=rc.dpr,scale=rc.readoutPriceScale??rc.priceScale;ctx.save();ctx.beginPath();ctx.rect(0,0,rc.plotWidth*dpr,rc.plotHeight*dpr);ctx.clip();ctx.font=`${10*dpr}px monospace`;ctx.lineWidth=dpr;ctx.setLineDash([4*dpr,4*dpr]);for(const w of this.watches){const top=scale.priceToY(w.definition.upper)*dpr,bottom=scale.priceToY(w.definition.lower)*dpr;if(bottom<0||top>rc.plotHeight*dpr)continue;ctx.fillStyle=rc.theme.axisText;ctx.globalAlpha=.06;ctx.fillRect(0,top,rc.plotWidth*dpr,bottom-top);ctx.strokeStyle=rc.theme.axisText;ctx.globalAlpha=.6;ctx.beginPath();ctx.moveTo(0,top);ctx.lineTo(rc.plotWidth*dpr,top);ctx.moveTo(0,bottom);ctx.lineTo(rc.plotWidth*dpr,bottom);ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=rc.theme.axisText;ctx.fillText(`${w.definition.name.slice(0,28)} · ${w.state} · ${w.quality}`,8*dpr,Math.max(12*dpr,top-4*dpr));}ctx.restore();}
}

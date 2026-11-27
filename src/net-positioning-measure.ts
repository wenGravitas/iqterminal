import type {Scheduler} from './chart/scheduler';
import type {OpenAlgoCandleChart} from './chart/openalgo';
import {renderPositioningTooltip} from './net-positioning-tooltip';
type Side='longs'|'shorts';
interface Hit {id:string;timeMs:number;side:Side}
interface Selection extends Hit {endMs:number;phase:'pressed'|'armed'|'dragging'|'pinned'}
/** A temporary indicator measurement, independent from saved chart drawings. */
export class NetPositioningMeasure {
 visible=true;
 private selection?:Selection;
 private down?:{id:number;x:number;y:number;second:boolean};
 private abort=new AbortController();
 private box=document.createElement('div');
 private tooltip=document.createElement('div');
 private body=document.createElement('div');
 private close=document.createElement('button');
 constructor(private host:HTMLElement,private scheduler:Scheduler,private options:{
  hit:(x:number,y:number)=>Hit|null;time:(id:string,x:number)=>number|null;
  frame:(s:Selection)=>ReturnType<OpenAlgoCandleChart['netPositioningMeasureFrame']>;
  enabled:()=>boolean;begin:()=>void;
 }){
  this.box.className='net-positioning-measure-box';this.box.hidden=true;
  this.tooltip.className='net-positioning-tooltip net-positioning-measure-tooltip';this.tooltip.hidden=true;this.tooltip.setAttribute('role','status');this.tooltip.setAttribute('aria-label','Net positioning range totals');
  this.close.type='button';this.close.className='positioning-measure-close';this.close.textContent='×';this.close.setAttribute('aria-label','Close range totals');this.close.title='Close range totals';
  this.tooltip.append(this.body,this.close);host.append(this.box,this.tooltip);
  const signal=this.abort.signal;
  this.close.addEventListener('click',e=>{e.stopPropagation();this.clear();},{signal});
  for(const name of ['pointerdown','mousedown','dblclick'] as const)this.tooltip.addEventListener(name,e=>e.stopPropagation(),{signal});
  host.addEventListener('pointerdown',e=>this.start(e),{capture:true,signal});
  host.addEventListener('pointermove',e=>this.move(e),{capture:true,signal});
  host.addEventListener('pointerup',e=>this.finish(e),{capture:true,signal});
  host.addEventListener('pointercancel',()=>this.clear(),{signal});
  host.addEventListener('lostpointercapture',()=>{if(this.down)this.clear();},{signal});
  window.addEventListener('blur',()=>{if(this.selection?.phase!=='pinned')this.clear();},{signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(this.selection?.phase!=='pinned')this.clear();}else this.invalidate();},{signal});
  host.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.active){e.preventDefault();e.stopImmediatePropagation();this.clear();}},{capture:true,signal});
 }
 get active(){return !!this.selection;}
 private point(e:PointerEvent){const r=this.host.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
 private stop(e:PointerEvent){e.preventDefault();e.stopImmediatePropagation();}
 private start(e:PointerEvent){
  if(!this.visible||e.button!==0||e.isPrimary===false||e.pointerType==='touch'||e.ctrlKey||e.metaKey||e.altKey||!this.options.enabled()||(e.target as HTMLElement).closest('button,input,select,textarea,.active-indicators,.pane-indicator-layer,.net-positioning-measure-tooltip'))return;
  const p=this.point(e),hit=this.options.hit(p.x,p.y);if(!hit)return;
  const second=this.selection?.phase==='armed'&&this.selection.id===hit.id&&this.selection.side===hit.side;
  if(second){this.selection!.endMs=hit.timeMs;}else this.selection={...hit,endMs:hit.timeMs,phase:'pressed'};
  this.down={id:e.pointerId,...p,second:!!second};this.options.begin();this.host.focus({preventScroll:true});this.stop(e);
  this.host.setPointerCapture(e.pointerId);this.invalidate();
 }
 private move(e:PointerEvent){
  const s=this.selection;if(!s||s.phase==='pinned')return;
  const p=this.point(e),time=this.options.time(s.id,p.x),before=s.endMs,phase=s.phase;if(time!==null)s.endMs=time;
  if(this.down){if(Math.hypot(p.x-this.down.x,p.y-this.down.y)>3)s.phase='dragging';this.stop(e);}
  if(before!==s.endMs||phase!==s.phase)this.invalidate();
 }
 private finish(e:PointerEvent){
  const d=this.down,s=this.selection;if(!d||d.id!==e.pointerId||!s)return;
  this.stop(e);this.down=undefined;
  if(this.host.hasPointerCapture(e.pointerId))this.host.releasePointerCapture(e.pointerId);
  if(s.phase==='dragging'){this.clear();return;}
  if(d.second){if(s.timeMs===s.endMs){this.clear();return;}s.phase='pinned';}else s.phase='armed';
  this.invalidate();
 }
 invalidate(){if(this.selection)this.scheduler.invalidate(this);}
 draw(){
  const s=this.selection;if(!s||!this.visible)return;
  const frame=this.options.frame(s);if(!frame){this.clear();return;}
  this.box.hidden=frame.width<=0;Object.assign(this.box.style,{left:`${frame.left}px`,top:`${frame.top}px`,width:`${frame.width}px`,height:`${frame.height}px`});
  this.box.dataset.side=s.side;this.box.dataset.pinned=String(s.phase==='pinned');
  renderPositioningTooltip(this.body,frame.summary);
  const stamp=this.body.querySelector('.positioning-tooltip-header > span');if(stamp){const date=(t:number)=>new Date(t).toISOString().replace('T',' ').slice(5,16);stamp.textContent=`${date(frame.summary.timeMs)} – ${date(frame.summary.endMs)} UTC`;}
  const hint=document.createElement('div');hint.className='positioning-tooltip-muted positioning-tooltip-status';hint.textContent=`${frame.summary.barCount} bars · ${s.phase==='pinned'?'Pinned range':s.phase==='dragging'?'Release to clear':'Click another bar to pin · Esc to cancel'}`;this.body.append(hint);
  this.close.hidden=s.phase!=='pinned';this.tooltip.dataset.pinned=String(s.phase==='pinned');this.tooltip.hidden=false;
  const width=this.tooltip.offsetWidth,height=this.tooltip.offsetHeight;
  const after=frame.left+frame.width+8,before=frame.left-width-8,left=after+width<=this.host.clientWidth-4?after:before>=4?before:after;
  this.tooltip.style.left=`${Math.max(4,Math.min(this.host.clientWidth-width-4,left))}px`;
  this.tooltip.style.top=`${Math.max(4,Math.min(this.host.clientHeight-height-4,frame.top+4))}px`;
 }
 clear(){const id=this.down?.id;this.down=undefined;this.selection=undefined;if(id!==undefined&&this.host.hasPointerCapture(id))this.host.releasePointerCapture(id);this.box.hidden=true;this.tooltip.hidden=true;this.scheduler.remove(this);}
 setVisible(visible:boolean){this.visible=visible;if(!visible)this.clear();}
 dispose(){this.clear();this.abort.abort();this.box.remove();this.tooltip.remove();}
}

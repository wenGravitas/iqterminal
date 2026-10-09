import { Viewport, CandleStore } from './model';
export class InputController {
  private abort=new AbortController();private drag:number|null=null;
  constructor(element:HTMLElement,viewport:Viewport,store:CandleStore,invalidate:(geometry:boolean)=>void,crosshair:(point:{x:number;y:number}|null)=>void) {
    const options={signal:this.abort.signal};
    const point=(e:PointerEvent)=>{const r=element.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
    element.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.drag=e.clientX;element.setPointerCapture(e.pointerId);element.focus();},options);
    element.addEventListener('pointermove',e=>{if(this.drag!==null){viewport.pan(e.clientX-this.drag,store.length);this.drag=e.clientX;invalidate(true);}crosshair(point(e));invalidate(false);},options);
    const stop=()=>{this.drag=null;};element.addEventListener('pointerup',stop,options);element.addEventListener('pointercancel',stop,options);
    element.addEventListener('pointerleave',()=>{if(this.drag===null){crosshair(null);invalidate(false);}},options);
    element.addEventListener('wheel',e=>{e.preventDefault();const r=element.getBoundingClientRect();viewport.zoom(e.clientX-r.left,Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.003));invalidate(true);},{...options,passive:false});
    element.addEventListener('dblclick',()=>{viewport.latest(store.length);invalidate(true);},options);
    element.addEventListener('keydown',e=>{if(e.key==='Home'){viewport.latest(store.length);invalidate(true);}else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){viewport.pan(e.key==='ArrowLeft'?40:-40,store.length);invalidate(true);e.preventDefault();}else if(e.key==='+'||e.key==='-'){viewport.zoom(viewport.plot.x+viewport.plot.width/2,e.key==='+'?1.2:1/1.2);invalidate(true);}},options);
  }
  dispose(){this.abort.abort();}
}

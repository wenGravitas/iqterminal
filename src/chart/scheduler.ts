export interface Drawable { visible:boolean; draw():void }
export class Scheduler {
  private dirty=new Set<Drawable>();private frame=0;private dead=false;
  readonly intervals:number[]=[];private last=0;
  private visibility=()=>{if(document.hidden){cancelAnimationFrame(this.frame);this.frame=0;this.last=0;}else this.request();};
  constructor(){document.addEventListener('visibilitychange',this.visibility);}
  invalidate(chart:Drawable){if(this.dead)return;this.dirty.add(chart);this.request();}
  private request(){if(this.frame||document.hidden||![...this.dirty].some(c=>c.visible))return;this.frame=requestAnimationFrame(t=>{this.frame=0;if(this.last)this.intervals.push(t-this.last);if(this.intervals.length>2000)this.intervals.shift();this.last=t;for(const c of [...this.dirty]){if(c.visible){this.dirty.delete(c);c.draw();}}if([...this.dirty].some(c=>c.visible))this.request();else this.last=0;});}
  remove(c:Drawable){this.dirty.delete(c);if(!this.dirty.size){cancelAnimationFrame(this.frame);this.frame=0;this.last=0;}}
  dispose(){this.dead=true;cancelAnimationFrame(this.frame);this.dirty.clear();document.removeEventListener('visibilitychange',this.visibility);}
}

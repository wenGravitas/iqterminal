import type { ConditionsPoint } from './engine';
import type { AlertEvent, ConditionsSettings } from './settings';
interface Crossing { side:boolean|null; pending:boolean|null; count:number }
/** Completed-bar transition detector; historical replay/corrections seed state without delivery. */
export class ConditionsAlerts {
  private previous:ConditionsPoint|null=null;private last=-Infinity;
  private above:Crossing={side:null,pending:null,count:0};private below:Crossing={side:null,pending:null,count:0};
  constructor(private settings:ConditionsSettings){}
  private cross(state:Crossing,score:number,threshold:number,above:boolean){
    const s=this.settings;let side=above?score>=threshold:score<threshold;
    if(state.side===true)side=above?score>=threshold-s.alertHysteresis:score<threshold+s.alertHysteresis;
    if(state.side===null){state.side=side;return false;}
    if(side===state.side){state.pending=null;state.count=0;return false;}
    if(side!==state.pending){state.pending=side;state.count=0;}
    if(++state.count<s.alertConfirmation)return false;
    const fired=side;state.side=side;state.pending=null;state.count=0;return fired;
  }
  seed(point:ConditionsPoint|undefined){this.previous=point??null;this.last=point?.t??-Infinity;this.above={side:point?.score===null||point?.score===undefined?null:point.score>=this.settings.alertAbove,pending:null,count:0};this.below={side:point?.score===null||point?.score===undefined?null:point.score<this.settings.alertBelow,pending:null,count:0};}
  next(point:ConditionsPoint):AlertEvent[]{
    if(point.t<=this.last)return [];this.last=point.t;
    const previous=this.previous;this.previous=point;
    if(!previous){this.seed(point);return [];}
    const events:AlertEvent[]=[];
    if(previous.regime==='COMPRESSION'&&point.regime!==null&&point.regime!=='COMPRESSION')events.push('compression-exit');
    if(previous.regime!==null&&point.regime!==null&&previous.regime!==point.regime){if(point.regime==='EXPANDING')events.push('expansion');if(point.regime==='EXTREME')events.push('extreme');if(point.regime==='EXPANDING'&&point.score!==null&&point.score>=this.settings.combinedThreshold)events.push('combined');}
    if(point.band!==null&&previous.band!==null&&point.band!==previous.band)events.push('classification');
    if(point.score!==null&&previous.score!==null){
      if(this.cross(this.above,point.score,this.settings.alertAbove,true))events.push('score-above');
      if(this.cross(this.below,point.score,this.settings.alertBelow,false))events.push('score-below');
    }else{this.above={side:point.score===null?null:point.score>=this.settings.alertAbove,pending:null,count:0};this.below={side:point.score===null?null:point.score<this.settings.alertBelow,pending:null,count:0};}
    return events.filter(e=>this.settings.alertEvents.includes(e));
  }
}

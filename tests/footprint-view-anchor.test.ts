import {test,expect} from 'vitest';
import {OpenAlgoCandleChart} from '../src/chart/openalgo';
const base=1800000000,hour=3600;
function harness(initial:number[]){
 let times=initial,range={from:0,to:times.length-1};
 const indexToTimeFloat=(index:number)=>{if(times.length===1)return times[0];const i=Math.max(0,Math.min(times.length-2,Math.floor(index)));return times[i]+(index-i)*(times[i+1]-times[i]);};
 const timeToIndexFloat=(time:number)=>{if(times.length===1)return 0;let i=0;while(i<times.length-2&&times[i+1]<time)i++;return i+(time-times[i])/(times[i+1]-times[i]);};
 const dataLayer={get length(){return times.length;},indexToTimeFloat,timeToIndexFloat};
 const e=Object.create(OpenAlgoCandleChart.prototype) as any;e.chart={dataLayer,getVisibleLogicalRange:()=>range,setVisibleLogicalRange:(next:any)=>range=next};
 return {e,set:(next:number[])=>times=next};
}
test('a single current point cannot claim an absolute saved view was restored',()=>{const {e}=harness([base+16*hour]);expect(e.restoreHistoryTimeRange({from:(base+11*hour)*1000,to:(base+19*hour)*1000})).toBe(false);expect(e.captureView()).toBeNull();});
test('absolute past and future whitespace survive sparse-to-dense history insertion',()=>{
 const {e,set}=harness([base+11*hour,base+15*hour,base+16*hour]);
 const wanted={from:(base+10*hour)*1000,to:(base+19*hour)*1000};
 expect(e.restoreHistoryTimeRange(wanted)).toBe(true);const view=e.captureView();
 set(Array.from({length:9},(_,i)=>base+(8+i)*hour));e.restoreView(view);
 expect(e.visibleTimeRange()).toEqual({from:wanted.from/1000,to:wanted.to/1000});
});

import {test,expect} from 'vitest';
import {OpenAlgoCandleChart} from '../src/chart/openalgo';

function harness(mode:'candle'|'footprint'){
 const timeScale={spacing:7,offset:0,get barSpacing(){return this.spacing;},setBarSpacing(value:number){this.spacing=value;},setRightOffset(value:number){this.offset=value;}};
 const engine=Object.create(OpenAlgoCandleChart.prototype) as any;
 Object.assign(engine,{mode,chart:{timeScale,resetScale(){}},footprintIndexSeries:{},footprintTimes:[1]});
 return{engine,timeScale};
}

test('Return to Present leaves a 112px candle gutter after resetting the chart',()=>{
 const{engine,timeScale}=harness('candle');engine.resetView();
 expect(timeScale.offset*timeScale.barSpacing).toBeCloseTo(112,8);
});

test('Return to Present keeps the readable footprint spacing and matching gutter',()=>{
 const{engine,timeScale}=harness('footprint');engine.resetView();
 expect(timeScale.barSpacing).toBe(112);expect(timeScale.offset*timeScale.barSpacing).toBeCloseTo(112,8);
});

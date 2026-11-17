import {expect,test} from 'vitest';
import {pastCandleViewport} from '../src/feed/candle-viewport';
const hour=3600000,day=Date.UTC(2026,10,3),now=day+16*hour+19*60000;
test('future whitespace cannot consume five eligible closed hours',()=>{
 for(const end of [19,23])expect(pastCandleViewport(day+11*hour,day+end*hour,now,hour)).toEqual({from:day+11*hour,to:day+16*hour});
});
test('Float64/IPC candle boundary noise cannot add an extra requested slot',()=>{
 for(const epsilon of [-1,-.000244,0,.000244,1])expect(pastCandleViewport(day+11*hour+epsilon,day+15*hour+epsilon,now,hour)).toEqual({from:day+11*hour,to:day+15*hour});
});
test('real partial intervals remain included and the source clock never rounds forward',()=>{
 expect(pastCandleViewport(day+11*hour-2,day+15*hour+2,now,hour)).toEqual({from:day+10*hour,to:day+16*hour});
 expect(pastCandleViewport(day+11*hour,day+20*hour,day+16*hour-1,hour)).toEqual({from:day+11*hour,to:day+15*hour});
});

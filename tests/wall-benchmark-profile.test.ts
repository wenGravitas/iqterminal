import {test,expect} from 'vitest';
import {wallBenchmarkSourceRequest} from '../scripts/wall-benchmark-preflight.mjs';
import {orderWallsArchiveProfileId} from '../src/feed/order-walls-archive';
import {orderWallsSettings} from '../src/feed/order-walls';
test('benchmark profile matches native Top Levels history settings for both markets',()=>{
 const reference={from:2000,to:3000,sourceFrom:1000,sourceTo:4000,sourceToken:'a'.repeat(64)},settings=orderWallsSettings({enabled:true,mode:'top-levels',topLevels:8,searchRangePercent:10,aggregation:'native',minDurationMs:0,showHistory:true});
 for(const [market,native]of [['spot','binance-spot'],['perpetual','binance-perp']]as const)expect(wallBenchmarkSourceRequest(market,reference).profile).toBe(orderWallsArchiveProfileId(native,settings));
});

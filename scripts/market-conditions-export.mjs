/** pnpm exec vite-node is not required: use the installed Vite module runner. No network or fixtures. */
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const [file,interval='5m',settingsFile]=process.argv.slice(2);
if(!file)throw new Error('Usage: node scripts/market-conditions-export.mjs candles.json 5m [settings.json] > conditions.csv');
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try {
 const {ConditionsEngine}=await server.ssrLoadModule('/src/market-conditions/engine.ts');
 const {conditionsSettings}=await server.ssrLoadModule('/src/market-conditions/settings.ts');
 const {canonicalSeries,duration,validCandle}=await server.ssrLoadModule('/src/feed/protocol.ts');
 const series=canonicalSeries({venue:'binance',interval});if(!series)throw new Error('Unsupported timeframe');
 const raw=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(raw)||!raw.every(validCandle))throw new Error('Expected canonical Candle[]: t,o,h,l,c,v,revision,closed (UTC milliseconds).');
 const engine=new ConditionsEngine(conditionsSettings(settingsFile?JSON.parse(await readFile(settingsFile,'utf8')):{}),duration[series.interval]);
 console.log('timestamp,timeframe,atr_percentile,bbw_percentile,er,chop,volatility_regime,tradeability,classification');
 for(const candle of raw.sort((a,b)=>a.t-b.t))for(const p of engine.update([candle]).changed)console.log([new Date(p.t).toISOString(),interval,p.atrRank??'',p.bbwRank??'',p.er??'',p.chop??'',p.regime??'',p.score??'',p.band??''].join(','));
}finally{await server.close();}

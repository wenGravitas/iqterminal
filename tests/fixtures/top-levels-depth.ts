import {OrderWallDetector,DEFAULT_ORDER_WALLS_SETTINGS,type OrderWallDepthRecord} from '../../src/feed/order-walls';
/** Explicit synthetic BTCUSDT book. Dense 0.1 rows plus persistent round-price liquidity.
 * Both source markets use the same deterministic scenario for visual comparisons,
 * never as a connection fallback. Exchange tick size is passed explicitly. */
export function topLevelsFixture(center:number,to:number,market:'spot'|'perpetual'='spot'){
 const from=to-4*3600000,step=120000,n=5000;
 const bids=Array.from({length:n},(_,i)=>[Number((center-(i+1)*.1).toFixed(1)),.02+(i%19)*.003] as const);
 const asks=Array.from({length:n},(_,i)=>[Number((center+(i+1)*.1).toFixed(1)),.025+(i%17)*.003] as const);
 const bidPrices=Array.from({length:9},(_,i)=>Number((center-25-i*50).toFixed(1))),askPrices=Array.from({length:9},(_,i)=>Number((center+25+i*50).toFixed(1)));
 const scope={bidComplete:false,askComplete:false,bidFloor:center-500,askCeiling:center+500};
 const rows:OrderWallDepthRecord[]=[{kind:'snapshot',at:from,cursor:1,epoch:1,bids:[...bids,...bidPrices.map((p,i)=>[p,i<8?12+15*i:2] as const)],asks:[...asks,...askPrices.map((p,i)=>[p,i<8?15+18*i:2] as const)],bookScope:scope}];
 for(let i=1;i<=120;i++)rows.push({kind:'delta',at:from+i*step,cursor:i+1,epoch:1,
  bids:bidPrices.map((p,j)=>[p,(j===8?(i>=40&&i<80?22:2):12+15*j)*(1+.05*Math.sin(i*.2+j))] as const),
  asks:askPrices.map((p,j)=>[p,(j===8?(i>=70&&i<90?24:2):15+18*j)*(1+.05*Math.cos(i*.2+j))] as const),bookScope:scope});
 const settings={...DEFAULT_ORDER_WALLS_SETTINGS,enabled:true,showPriceLines:true};
 const detector=new OrderWallDetector(settings,market==='spot'?.01:.1);
 detector.processBatch(rows);
 return {settings,segments:detector.snapshot(),status:detector.status(from,to),rows,market,from,to};
}

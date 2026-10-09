import { type Candle, type Series, duration } from './protocol';
export function fixtureBars(s:Series,count=5000):Candle[] {
  const step=duration[s.interval],end=Math.floor(1791558000000/step)*step;
  return Array.from({length:count},(_,i)=>{const o=83000+Math.sin(i*.023)*600+Math.sin(i*.31)*55+(s.venue==='hyperliquid'?18:0),c=o+Math.sin(i*1.7)*35;return {t:end-(count-1-i)*step,o,h:Math.max(o,c)+18,l:Math.min(o,c)-22,c,v:2+i%19,revision:0,closed:i<count-1};});
}

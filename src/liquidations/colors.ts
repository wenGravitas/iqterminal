import type {LiquidatedSide}from './model';
const cache=new Map<string,string>();
const rgb=(color:string)=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
const luminance=(v:number[])=>v.reduce((sum,c,i)=>{const x=c/255;return sum+(.04045>=x?x/12.92:((x+.055)/1.055)**2.4)*[.2126,.7152,.0722][i]!;},0);
/** Keep author colours in settings; adjust only small rendered text toward the
 * theme foreground when necessary, as existing order-flow labels do. */
export function liquidationInk(color:string,light=false){
 const key=color+light,known=cache.get(key);if(known)return known;
 const source=/^#[\da-f]{6}$/i.test(color)?rgb(color):[128,128,128],background=luminance(light?[246,244,238]:[9,9,9]),target=light?17:245;
 let result=source;for(let step=0;step<=20;step++){const alpha=step/20;result=source.map(c=>Math.round(c*(1-alpha)+target*alpha));const fg=luminance(result),contrast=(Math.max(fg,background)+.05)/(Math.min(fg,background)+.05);if(contrast>=4.6)break;}
 const value='#'+result.map(c=>c.toString(16).padStart(2,'0')).join('');cache.set(key,value);if(cache.size>128)cache.delete(cache.keys().next().value!);return value;
}
export function liquidationColour(side:LiquidatedSide,light=false){return liquidationInk(side==='LONG'?'#c86b66':'#4ca7ca',light);}

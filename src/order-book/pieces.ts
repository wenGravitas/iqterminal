/** Small pure helpers adapted from liquiditymapperfast, MIT, 6126de1cf249df9ed19a598d19939f39dd4301ba.
 * See docs/THIRD_PARTY_NOTICES.md. IQ keeps user source order and ranks lines by live depth, not traded volume. */
export interface BarPiece {id:string|null;notional:number;x:number;width:number;rank:number;merged:{id:string;notional:number}[]}
export function barPieces(ids:readonly string[],values:readonly number[],denominator:number,x:number,width:number,minPx=3):BarPiece[]{
 const out:BarPiece[]=[],small:{id:string;notional:number}[]=[],scale=denominator>0&&width>0?width/denominator:0;
 ids.forEach((id,rank)=>{const notional=values[rank]??0;if(!Number.isFinite(notional)||notional<=0)return;const w=notional*scale;
  if(w<minPx){small.push({id,notional});return;}out.push({id,notional,x,width:w,rank,merged:[]});x+=w;});
 if(small.length){const notional=small.reduce((s,c)=>s+c.notional,0);out.push({id:null,notional,x,width:notional*scale,rank:-1,merged:small});}
 return out;
}
export const pieceAt=(pieces:readonly BarPiece[],x:number)=>pieces.find(p=>x>=p.x&&x<p.x+p.width)??null;
export function pieceLabel(name:string,code:string,amount:string,width:number,measure:(text:string)=>number,padding=3){
 for(const label of [`${name} ${amount}`,`${code} ${amount}`,code])if(measure(label)+padding*2<=width)return label;return null;
}
export class TextMeasurements {
 private cache=new Map<string,number>();
 measure(font:string,text:string,measure:(text:string)=>number){const key=font+'|'+text;let value=this.cache.get(key);if(value!==undefined)return value;
  value=measure(text);if(this.cache.size>=512)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,value);return value;}
 get size(){return this.cache.size;}
 clear(){this.cache.clear();}
}
export class LiquidityRanking {
 private key='';private at=-Infinity;private ids:string[]=[];
 apply(now:number,ids:readonly string[],count:number,liquidity:(id:string)=>number){
  const key=count+'|'+ids.join(',');if(key!==this.key||now-this.at>=30000){this.key=key;this.at=now;this.ids=ids.map((id,i)=>({id,i,value:liquidity(id)}))
   .filter(x=>x.value>0).sort((a,b)=>b.value-a.value||a.i-b.i).slice(0,count).map(x=>x.id);}
  return this.ids;
 }
}
export const SOURCE_MARKS:Readonly<Record<string,{code:string;name:string;dark:string;light:string}>>={
 'binance-spot':{code:'BIN-S',name:'Binance Spot',dark:'#7db6e8',light:'#216494'},
 'binance-perpetual':{code:'BIN-P',name:'Binance Perp',dark:'#e7b471',light:'#895517'},
};
export const sourceMark=(id:string)=>SOURCE_MARKS[id]??{code:id.slice(0,6).toUpperCase(),name:id,dark:'#b0a6dc',light:'#63568e'};

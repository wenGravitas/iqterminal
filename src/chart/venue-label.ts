export type LabelVenue='binance'|'hyperliquid'|'bybit';
const icons=new Map<LabelVenue,CanvasImageSource>();
export const venueIconPath=(venue:LabelVenue)=>venue==='binance'?'/venues/binance.ico':venue==='bybit'?'/venues/bybit.svg':'/venues/hyperliquid.png';
export const venueBadge=(venue:LabelVenue,market:'spot'|'perpetual'='perpetual')=>`${venue==='binance'?'BN':venue==='bybit'?'BY':'HL'}[${market==='spot'?'S':'P'}]`;
export function setVenueLabelIcon(venue:LabelVenue,icon:CanvasImageSource){icons.set(venue,icon);}
export function venueLabelIcon(venue:LabelVenue){return icons.get(venue);}
export function compactVenueText(text:string){return text.replace(/^(BINANCE|BYBIT|HYPERLIQUID) (PERP|SPOT)/,(_,v,m)=>venueBadge(v.toLowerCase() as LabelVenue,m==='SPOT'?'spot':'perpetual'));}
/** Label kernels receive loaded image assets from the DOM-owning chart adapter. */
export function drawVenueCaption(ctx:CanvasRenderingContext2D,venue:LabelVenue,text:string,right:number,y:number,dpr:number,maxWidth:number){
 if(maxWidth<=0)return;
 const icon=venueLabelIcon(venue),size=12*dpr,gap=4*dpr,iconSpace=icon?size+gap:0;
 const width=Math.min(maxWidth,ctx.measureText(text).width+iconSpace),left=right-width;
 if(icon)ctx.drawImage(icon,left,y-10*dpr,size,size);
 ctx.textAlign='left';ctx.fillText(text,left+iconSpace,y,Math.max(0,width-iconSpace));
}

export type LabelCurrency='btc'|'usdt';
const currencies=new WeakMap<object,(local?:LabelCurrency)=>LabelCurrency>();
export function setLabelCurrencySource(layer:object,source:((local?:LabelCurrency)=>LabelCurrency)|null){if(source)currencies.set(layer,source);else currencies.delete(layer);}
export function labelCurrency(layer:object,local?:LabelCurrency):LabelCurrency{return currencies.get(layer)?.(local)??local??'btc';}
export interface LabelAmount {venue:LabelVenue;market?:'spot'|'perpetual';baseAmount?:number|null;quoteAmount?:number|null}
export function amountCaption(amount:LabelAmount,currency:LabelCurrency){
 const value=currency==='btc'?amount.baseAmount:amount.quoteAmount,unit=currency==='btc'?'BTC':amount.venue==='hyperliquid'?'USD':'USDT';
 const text=value==null||!Number.isFinite(value)?'N/A':Math.abs(value)>=1000?value.toLocaleString('en-US',{notation:'compact',maximumFractionDigits:2}):value.toLocaleString('en-US',{maximumFractionDigits:currency==='btc'&&value!==0&&Math.abs(value)<.001?8:3});
 return `${venueBadge(amount.venue,amount.market)} ${text} ${unit}`;
}

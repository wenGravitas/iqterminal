import {it,expect} from 'vitest';
import {drawAxisPriceLabel,drawAxisPriceRange} from '../src/chart/drawing-labels';
import {venueBadge,compactVenueText,setVenueLabelIcon,drawVenueCaption,amountCaption,labelCurrency,setLabelCurrencySource} from '../src/chart/venue-label';
it('shares price-axis tag styling between ticker lines and zone boundaries, including close boundaries',()=>{
 const texts:any[]=[],fills:any[]=[];
 const ctx:any={save(){},restore(){},beginPath(){},rect(){},clip(){},measureText(t:string){return {width:t.length*6};},fillRect(...a:any[]){fills.push([...a,this.fillStyle]);},fillText(...a:any[]){texts.push(a);}};
 const scale={format:(p:number)=>p.toFixed(1),priceToY:(p:number)=>200-p};
 const rc:any={dpr:1,plotWidth:300,plotHeight:200,priceAxisSide:'right',priceAxisWidth:80,priceAxisOffset:300,priceScale:scale};
 drawAxisPriceLabel(ctx,rc,{price:100,y:100,color:'#ad5858',alpha:1});
 drawAxisPriceRange(ctx,rc,100,101,'#ad5858');
 expect(texts.map(t=>t[0])).toEqual(['100.0','101.0','100.0']);expect(texts.every(t=>t[1]>300)).toBe(true);
 expect(Math.abs(texts[2][2]-texts[1][2])).toBeGreaterThanOrEqual(18);expect(fills.every(f=>f[4]==='#ad5858')).toBe(true);
 texts.length=0;drawAxisPriceRange(ctx,{...rc,priceAxisSide:'hidden'},100,101,'#ad5858');expect(texts).toEqual([]);
});
it('uses the same venue badges as the toggle, with a loaded 12px icon in canvas captions',()=>{
 expect(venueBadge('binance')).toBe('BN[P]');expect(venueBadge('binance','spot')).toBe('BN[S]');expect(venueBadge('hyperliquid')).toBe('HL[P]');expect(venueBadge('bybit')).toBe('BY[P]');
 expect(compactVenueText('BINANCE PERP · BUY')).toBe('BN[P] · BUY');
 const calls:any[]=[],ctx:any={measureText:()=>({width:80}),drawImage:(...a:any[])=>calls.push(a),fillText:(...a:any[])=>calls.push(a)};
 const icon={} as CanvasImageSource;setVenueLabelIcon('binance',icon);drawVenueCaption(ctx,'binance','BN[P] · BUY',300,100,1,200);
 expect(calls[0]).toEqual([icon,204,90,12,12]);expect(calls[1][0]).toBe('BN[P] · BUY');
});

it('formats only badge and amount, preserves signed values and resolves local/global currencies',()=>{
 const amount={venue:'binance' as const,baseAmount:-1.25,quoteAmount:-100000};
 expect(amountCaption(amount,'btc')).toBe('BN[P] -1.25 BTC');expect(amountCaption(amount,'usdt')).toBe('BN[P] -100K USDT');
 expect(amountCaption({...amount,venue:'hyperliquid'},'usdt')).toBe('HL[P] -100K USD');
 expect(amountCaption({venue:'bybit',baseAmount:0.00000001,quoteAmount:null},'btc')).toBe('BY[P] 0.00000001 BTC');
 expect(amountCaption({venue:'bybit',quoteAmount:null},'usdt')).toBe('BY[P] N/A USDT');
 const layer={};setLabelCurrencySource(layer,local=>local??'usdt');expect(labelCurrency(layer)).toBe('usdt');expect(labelCurrency(layer,'btc')).toBe('btc');
 setLabelCurrencySource(layer,()=> 'usdt');expect(labelCurrency(layer,'btc')).toBe('usdt');setLabelCurrencySource(layer,null);expect(labelCurrency(layer)).toBe('btc');
});

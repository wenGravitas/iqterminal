import {depthMatrixSettings,matrixBucketIndex,type DepthMatrixSettings,type DepthMatrixViewport} from '../feed/depth-matrix';
export type OrderBookMode='compact'|'single';
export type OrderBookShow='levels'|'cumulative'|'both';
export interface OrderBookSettings extends DepthMatrixSettings {
 orderBookVersion:1;mode:OrderBookMode;grouping:'auto'|string;
 compact:{show:OrderBookShow;venueLines:number};
 viewport?:DepthMatrixViewport;priceAnchor?:{price:string;offset:number};
}
export const ORDER_BOOK_GROUPS=['0.1','1','5','10','25','50','100','250','500','1000'];
/** Auto is a stable BTC tick-compatible 100 USDT group in R1; resizing is presentation-only. */
export function orderBookSettings(value:unknown,legacy=false):OrderBookSettings {
 const raw=value&&typeof value==='object'?value as Record<string,any>:{};
 const base=depthMatrixSettings({...raw.single,...raw});
 const grouping=raw.grouping==='auto'?'auto':typeof raw.grouping==='string'&&ORDER_BOOK_GROUPS.includes(raw.grouping)?raw.grouping:raw.bucketWidth!==undefined?base.bucketWidth:'auto';
 const c=raw.compact??{},view=raw.viewport,anchor=raw.priceAnchor;
 return {...base,orderBookVersion:1,mode:legacy?'single':raw.mode==='single'?'single':'compact',grouping,
  bucketWidth:grouping==='auto'?'100':grouping,
  compact:{show:['levels','cumulative'].includes(c.show)?c.show:'both',venueLines:[0,1,2].includes(c.venueLines)?c.venueLines:2},
  ...(validViewport(view)?{viewport:{low:view.low,high:view.high}}:{}),
  ...(anchor&&typeof anchor.price==='string'&&matrixBucketIndex(anchor.price,'0.00000001')!==null&&Number.isFinite(anchor.offset)&&anchor.offset>=0&&anchor.offset<=100?{priceAnchor:{price:anchor.price,offset:anchor.offset}}:{})};
}
function validViewport(v:any):v is DepthMatrixViewport{return !!v&&typeof v.low==='string'&&typeof v.high==='string'&&matrixBucketIndex(v.low,'0.00000001')!==null&&matrixBucketIndex(v.high,'0.00000001')!==null&&Number(v.high)>Number(v.low);}
export function serializeOrderBookSettings(settings:OrderBookSettings){
 const {columnWidth,unit,scale,wallMode,wallThreshold}=settings;
 return {...settings,single:{columnWidth,unit,scale,wallMode,wallThreshold},compact:{...settings.compact}};
}
/** Pure, versioned, idempotent migration. IDs and dock graph references never change. */
export function migrateOrderBookPanel(panel:{contentComponent?:string;title?:string;params?:any}){
 if(panel.contentComponent==='depth-matrix'){
  panel.contentComponent='order-book';panel.title='Order Book';panel.params=serializeOrderBookSettings(orderBookSettings(panel.params,true));
 }else if(panel.contentComponent==='order-book'){
  panel.title='Order Book';panel.params=serializeOrderBookSettings(orderBookSettings(panel.params));
 }
 return panel;
}

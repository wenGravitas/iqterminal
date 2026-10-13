/** Versioned column-major Float64 wire layout. Statistics remain exact integers
 * in storage; these are the same display numbers as the JSON tile contract. */
const fields=['low','bid','ask','bidQuote','askQuote','bidPeak','askPeak','bidQuotePeak','askQuotePeak','bidDuration','askDuration'] as const;
const STRIDE=13,MAX_CELLS=16384,MAX_HEADER=262144;
export function encodeHistory(data:any):Uint8Array {
 const epochs:number[][]=[],epochIds=new Map<string,number>();let count=0;
 const tiles=data.tiles.map((tile:any)=>{const {cells,...meta}=tile;const offset=count;count+=cells.length;return {...meta,offset,count:cells.length};});
 if(count>MAX_CELLS)throw Error('History wire cell budget');
 const values=new Float64Array(count*STRIDE);let index=0;
 for(const tile of data.tiles)for(const cell of tile.cells){for(let field=0;field<fields.length;field++)values[field*count+index]=cell[fields[field]!]??NaN;values[11*count+index]=Number(cell.bidComplete)+2*Number(cell.askComplete);const key=cell.epochs.join(',');let epoch=epochIds.get(key);if(epoch===undefined){epoch=epochs.length;epochIds.set(key,epoch);epochs.push(cell.epochs);}values[12*count+index]=epoch;index++;}
 const header=new TextEncoder().encode(JSON.stringify({...data,tiles,wire:1,stride:STRIDE,totalCells:count,epochs}));if(header.length>MAX_HEADER)throw Error('History wire header budget');
 const bytes=new Uint8Array(4+header.length+values.byteLength),view=new DataView(bytes.buffer);view.setUint32(0,header.length,true);bytes.set(header,4);for(let i=0;i<values.length;i++)view.setFloat64(4+header.length+i*8,values[i]!,true);return bytes;
}
export function decodeHistory(bytes:ArrayBuffer):any {
 if(bytes.byteLength<4)throw Error('Invalid history wire');const view=new DataView(bytes),length=view.getUint32(0,true);if(length>MAX_HEADER||length+4>bytes.byteLength)throw Error('History wire header budget');const data=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,4,length))),count=data.totalCells;
 if(data.wire!==1||data.stride!==STRIDE||!Number.isSafeInteger(count)||count<0||count>MAX_CELLS||bytes.byteLength!==4+length+count*STRIDE*8||!Array.isArray(data.epochs)||data.epochs.length>MAX_CELLS||!Array.isArray(data.tiles)||data.tiles.length>256)throw Error('Invalid history wire layout');
 const value=(field:number,index:number)=>view.getFloat64(4+length+(field*count+index)*8,true);let end=0;
 for(const tile of data.tiles){if(tile.offset!==end||!Number.isSafeInteger(tile.count)||tile.count<0||tile.count>64||end+tile.count>count)throw Error('Invalid history wire tile');tile.cells=[];for(let index=tile.offset;index<tile.offset+tile.count;index++){const cell:any={time:tile.from};for(let field=0;field<fields.length;field++){const v=value(field,index);if(Number.isNaN(v)&&field>=1&&field<=4)cell[fields[field]!]=null;else{if(!Number.isFinite(v))throw Error('Invalid history wire number');cell[fields[field]!]=v;}}const flags=value(11,index),epoch=value(12,index);if(!Number.isInteger(flags)||flags<0||flags>3||!Number.isInteger(epoch)||!Array.isArray(data.epochs[epoch]))throw Error('Invalid history wire coverage');cell.high=cell.low+tile.rowPrice;cell.bidComplete=Boolean(flags&1);cell.askComplete=Boolean(flags&2);cell.epochs=data.epochs[epoch];tile.cells.push(cell);}end+=tile.count;delete tile.offset;delete tile.count;}
 if(end!==count)throw Error('Incomplete history wire');delete data.wire;delete data.stride;delete data.totalCells;delete data.epochs;return data;
}

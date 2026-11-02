/** Bound imported images before asking a browser decoder to allocate their surface. */
export function validatePng(bytes: Uint8Array) {
  if (bytes.length < 45 || ![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) throw Error('Backup image is not a complete PNG');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8,header=false,data=false,end=false;
  while(offset+12<=bytes.length){const length=view.getUint32(offset),type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));if(length>bytes.length-offset-12)throw Error('Truncated PNG chunk');
    if(!header){if(type!=='IHDR'||length!==13)throw Error('PNG header is missing');const width=view.getUint32(offset+8),height=view.getUint32(offset+12);if(!width||!height||width>16384||height>16384||width*height>32_000_000)throw Error('PNG exceeds the 32 megapixel image limit');header=true;}
    else if(type==='IHDR')throw Error('Duplicate PNG header');
    if(type==='IDAT')data=true;if(type==='IEND'){if(length!==0)throw Error('Invalid PNG end');end=true;offset+=12;break;}offset+=length+12;
  }
  if(!header||!data||!end||offset!==bytes.length)throw Error('PNG is truncated or contains trailing data');
}

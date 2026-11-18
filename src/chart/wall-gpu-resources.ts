import type {PrimitiveRenderContext} from 'openalgo-charts';
import {WallLogicalMapping} from './wall-logical-mapping';

export interface WallRenderSpan {
  id:string;runIndex:number;from:number;to:number;price:number;usd:number|null;side:'bid'|'ask';current?:boolean;historical?:boolean;
}
export interface WallRenderStyle {
  min:number;max:number;highContrast:boolean;strengthThickness:boolean;thickness:number;opacity:number;
  bid:readonly string[];ask:readonly string[];
}
export const WALL_GPU_BATCH_RUNS=512;
const FLOATS=10,STRIDE=FLOATS*4;
const MAX_GPU_BYTES=64*1024*1024;
export function splitWallCoordinate(value:number):[number,number]{const high=Math.fround(value);return [high,Math.fround(value-high)];}
export function wallStrengthTier(value:number,style:Pick<WallRenderStyle,'min'|'max'|'highContrast'>){
  const strength=style.max<=0?0:style.highContrast?(style.max===style.min?.5:Math.max(0,Math.min(1,(value-style.min)/(style.max-style.min)))):Math.max(0,Math.min(1,value/style.max));
  return strength>=.85?3:strength>=.55?2:strength>=.25?1:0;
}
/** CPU double comparisons choose exact tier cutoffs. Float32 notionals never
 * decide financial thresholds in the shader. Ranks <=512 are represented exactly. */
export function wallTierCuts(values:readonly number[],style:Pick<WallRenderStyle,'min'|'max'|'highContrast'>):[number,number,number]{
  return [1,2,3].map(tier=>{let lo=0,hi=values.length;while(lo<hi){const mid=(lo+hi)>>>1;if(wallStrengthTier(values[mid]!,style)<tier)lo=mid+1;else hi=mid;}return lo;}) as [number,number,number];
}

/** Public chart scales are affine in native price, or log10(price). Resolve
 * the camera from the public conversion functions, preserving inversion,
 * margins, rebasing and native tick precision. */
export function wallPriceCamera(rc:PrimitiveRenderContext,base:number){
  const log=rc.priceScale.options?.mode==='logarithmic',top=rc.priceScale.yToPrice(0);
  if(!Number.isFinite(top)||log&&top<=0)return;
  const second=base*1.001,unit=log?Math.log10(second/base):second-base;
  const scale=(rc.priceScale.priceToY(second)-rc.priceScale.priceToY(base))/unit;
  if(!Number.isFinite(scale)||scale===0)return;
  return {priceOrigin:splitWallCoordinate(log?Math.log10(top/base):top-base),priceScale:scale*rc.dpr,log};
}

const VERTEX=`#version 300 es
precision highp float;
layout(location=0) in vec4 times;
layout(location=1) in vec4 prices;
layout(location=2) in vec2 rankSide;
layout(location=3) in float enabled;
uniform vec2 size;
uniform vec2 timeOrigin;
uniform float timeScale;
uniform vec2 priceOrigin;
uniform float priceScale;
uniform bool logPrice;
uniform vec3 cuts;
uniform vec4 thicknesses;
uniform vec4 palette[8];
uniform float opacity;
uniform float pixelRatio;
flat out vec4 ink;
flat out vec4 bounds;
void main(){
 if(enabled<.5){gl_Position=vec4(2,2,0,1);ink=vec4(0);bounds=vec4(0);return;}
 float left=((times.x-timeOrigin.x)+(times.y-timeOrigin.y))*timeScale;
 float right=((times.z-timeOrigin.x)+(times.w-timeOrigin.y))*timeScale;
 if(right<0.0||left>size.x){gl_Position=vec4(2,2,0,1);ink=vec4(0);bounds=vec4(0);return;}
 left=max(0.0,left);right=max(left+1.0,min(size.x,right));
 vec2 p=logPrice?prices.zw:prices.xy;
 float y=((p.x-priceOrigin.x)+(p.y-priceOrigin.y))*priceScale;
 float rank=rankSide.x;
 int tier=rank<cuts.x?0:rank<cuts.y?1:rank<cuts.z?2:3;
 float thickness=rank<0.0?pixelRatio:thicknesses[tier];
 ink=rank<0.0?vec4(vec3(107.0/255.0),opacity):vec4(palette[tier+int(rankSide.y)*4].rgb,opacity);
 bounds=vec4(left,right,y,thickness*.5);
 int corner=gl_VertexID;
 float x=(corner==1||corner==2||corner==4)?right+.5:left-.5;
 float dy=(corner==2||corner==4||corner==5)?thickness*.5+.5:-thickness*.5-.5;
 gl_Position=vec4(x/size.x*2.0-1.0,1.0-(y+dy)/size.y*2.0,0,1);
}`;
const FRAGMENT=`#version 300 es
precision highp float;
flat in vec4 ink;
flat in vec4 bounds;
uniform vec2 size;
out vec4 color;
void main(){
 float x=gl_FragCoord.x,y=size.y-gl_FragCoord.y;
 float a=ink.a*clamp(min(x-bounds.x+.5,bounds.y-x+.5),0.0,1.0)*clamp(bounds.w+.5-abs(y-bounds.z),0.0,1.0);
 color=vec4(ink.rgb*a,a);
}`;

/** One detached shared context, composited into the existing Canvas primitive
 * layer. All product chart backends are Canvas2D; charts do not gain a context
 * each. The final owner releases buffers, program and the shared context. */
class WallGpuDevice {
  readonly canvas=document.createElement('canvas');
  readonly gl:WebGL2RenderingContext;
  readonly program:WebGLProgram;
  readonly uniforms=new Map<string,WebGLUniformLocation>();
  owners=0;bytes=0;generation=0;lost=false;uploads=0;uploadedBytes=0;draws=0;
  private readonly listeners=new Set<()=>void>();
  constructor(){
    this.canvas.dataset.iqWallLayer='retained';
    const gl=this.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});
    if(!gl)throw Error('WebGL2 unavailable');this.gl=gl;
    const shader=(kind:number,source:string)=>{const value=gl.createShader(kind);if(!value)throw Error('Wall shader allocation failed');gl.shaderSource(value,source);gl.compileShader(value);if(!gl.getShaderParameter(value,gl.COMPILE_STATUS)){const reason=gl.getShaderInfoLog(value);gl.deleteShader(value);throw Error(reason??'Wall shader compilation failed');}return value;};
    const shaders:WebGLShader[]=[];let program:WebGLProgram|null=null;
    try {
      const vertex=shader(gl.VERTEX_SHADER,VERTEX);shaders.push(vertex);
      const fragment=shader(gl.FRAGMENT_SHADER,FRAGMENT);shaders.push(fragment);
      program=gl.createProgram();if(!program)throw Error('Wall program allocation failed');
      gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'Wall program link failed');
      for(const name of ['size','timeOrigin','timeScale','priceOrigin','priceScale','logPrice','cuts','thicknesses','palette[0]','opacity','pixelRatio']){const location=gl.getUniformLocation(program,name);if(location===null)throw Error('Missing wall uniform '+name);this.uniforms.set(name,location);}
      this.program=program;
    } catch(error) {
      if(program)gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();throw error;
    } finally { for(const shader of shaders)gl.deleteShader(shader); }
    this.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.lost=true;this.generation++;for(const notify of this.listeners)notify();});
  }
  own(notify:()=>void){this.owners++;this.listeners.add(notify);return ()=>{this.listeners.delete(notify);if(--this.owners===0){this.gl.deleteProgram(this.program);this.gl.getExtension('WEBGL_lose_context')?.loseContext();if(device===this)device=undefined;}};}
  allocate(data:Float32Array){if(this.lost||this.bytes+data.byteLength>MAX_GPU_BYTES)return;const buffer=this.gl.createBuffer();if(!buffer)return;this.gl.bindBuffer(this.gl.ARRAY_BUFFER,buffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,data,this.gl.STATIC_DRAW);this.bytes+=data.byteLength;this.uploads++;this.uploadedBytes+=data.byteLength;return buffer;}
  release(buffer:WebGLBuffer,bytes:number){this.gl.deleteBuffer(buffer);this.bytes=Math.max(0,this.bytes-bytes);}
  begin(width:number,height:number){const gl=this.gl;if(this.lost||width<1||height<1||width*height>16*1024*1024||width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||height>gl.getParameter(gl.MAX_TEXTURE_SIZE))return false;
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    gl.viewport(0,0,width,height);gl.useProgram(this.program);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform2f(this.uniforms.get('size')!,width,height);return true;}
}
let device:WallGpuDevice|undefined;
export function acquireWallGpu(notify:()=>void){
  if(typeof document==='undefined')return;
  try{if(!device||device.lost){if(device?.owners)return;device=new WallGpuDevice();}const current=device,release=current.own(notify);return {device:current,release};}catch{return;}
}

export class WallGpuBatch {
  private constructor(readonly spans:readonly WallRenderSpan[],readonly mapping:WallLogicalMapping,readonly priceBase:number,readonly values:readonly number[],readonly buffer:WebGLBuffer,readonly enabledBuffer:WebGLBuffer,readonly enabled:Float32Array,readonly bytes:number,readonly device:WallGpuDevice){}
  static prepare(rc:PrimitiveRenderContext,spans:readonly WallRenderSpan[],device:WallGpuDevice){
    if(!spans.length||spans.length>WALL_GPU_BATCH_RUNS)return;
    let from=Infinity,to=-Infinity;for(const span of spans){if(![span.from,span.to,span.price].every(Number.isFinite)||span.to<span.from||span.price<=0)return;from=Math.min(from,span.from);to=Math.max(to,span.to);}
    const mapping=WallLogicalMapping.capture(rc,from,to);if(!mapping)return;
    const priceBase=spans[0]!.price,values=[...new Set(spans.flatMap(span=>span.usd===null?[]:[span.usd]))].sort((a,b)=>a-b),ranks=new Map(values.map((v,i)=>[v,i])),data=new Float32Array(spans.length*FLOATS);
    for(let i=0;i<spans.length;i++){const span=spans[i]!,left=mapping.logical(span.from),right=mapping.logical(span.to);if(left===undefined||right===undefined)return;
      data.set([...splitWallCoordinate(left),...splitWallCoordinate(right),...splitWallCoordinate(span.price-priceBase),...splitWallCoordinate(Math.log10(span.price/priceBase)),span.usd===null?-1:ranks.get(span.usd)!,span.side==='bid'?0:1],i*FLOATS);}
    const buffer=device.allocate(data);if(!buffer)return;
    const enabled=new Float32Array(spans.length).fill(1),enabledBuffer=device.allocate(enabled);
    if(!enabledBuffer){device.release(buffer,data.byteLength);return;}
    return new WallGpuBatch(spans,mapping,priceBase,values,buffer,enabledBuffer,enabled,data.byteLength+enabled.byteLength,device);
  }
  dispose(){this.device.release(this.buffer,this.bytes-this.enabled.byteLength);this.device.release(this.enabledBuffer,this.enabled.byteLength);}
  hide(id:string,fromIndex= -1){let changed=false;for(let i=0;i<this.spans.length;i++){const span=this.spans[i]!;if(span.id===id&&span.runIndex>=fromIndex&&this.enabled[i]){this.enabled[i]=0;changed=true;}}
    if(changed){const gl=this.device.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.enabledBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.enabled);this.device.uploads++;this.device.uploadedBytes+=this.enabled.byteLength;}}

  camera(rc:PrimitiveRenderContext){
    const offset=this.mapping.offset(rc);if(offset===undefined)return;
    const originIndex=rc.timeScale.xToIndex(0)-offset,timeScale=rc.timeScale.indexToX(offset+1)-rc.timeScale.indexToX(offset);
    const price=wallPriceCamera(rc,this.priceBase);
    if(!price||!Number.isFinite(timeScale)||timeScale<=0)return;
    return {timeOrigin:splitWallCoordinate(originIndex),timeScale:timeScale*rc.dpr,...price};
  }
  paint(rc:PrimitiveRenderContext,style:WallRenderStyle,camera=this.camera(rc)){
    if(!camera||this.device.lost)return false;const {gl,uniforms:u}=this.device;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    for(const [location,count,offset]of [[0,4,0],[1,4,16],[2,2,32]]){gl.enableVertexAttribArray(location!);gl.vertexAttribPointer(location!,count!,gl.FLOAT,false,STRIDE,offset!);gl.vertexAttribDivisor(location!,1);}
    gl.bindBuffer(gl.ARRAY_BUFFER,this.enabledBuffer);gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,1,gl.FLOAT,false,4,0);gl.vertexAttribDivisor(3,1);
    gl.uniform1f(u.get('pixelRatio')!,rc.dpr);
    gl.uniform2fv(u.get('timeOrigin')!,camera.timeOrigin);gl.uniform1f(u.get('timeScale')!,camera.timeScale);
    gl.uniform2fv(u.get('priceOrigin')!,camera.priceOrigin);gl.uniform1f(u.get('priceScale')!,camera.priceScale);gl.uniform1i(u.get('logPrice')!,camera.log?1:0);
    gl.uniform3fv(u.get('cuts')!,wallTierCuts(this.values,style));gl.uniform4fv(u.get('thicknesses')!,[0,1,2,3].map(tier=>(style.strengthThickness?1+(style.thickness-1)*tier/3:style.thickness)*rc.dpr));
    gl.uniform1f(u.get('opacity')!,style.opacity);
    gl.uniform4fv(u.get('palette[0]')!,[...style.bid,...style.ask].flatMap(color=>{const n=parseInt(color.slice(1),16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1];}));
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,this.spans.length);this.device.draws++;return true;
  }
  extent(from:number,to:number,low:number,high:number){let min=Infinity,max=0;for(let i=0;i<this.spans.length;i++){const span=this.spans[i]!;if(this.enabled[i]&&span.to>=from&&span.from<=to&&span.price>=low&&span.price<=high&&span.usd!==null&&span.usd>0){min=Math.min(min,span.usd);max=Math.max(max,span.usd);}}return {min,max};}
}

export function wallGpuResourceUsage(){return {contexts:device?1:0,owners:device?.owners??0,bufferBytes:device?.bytes??0,bufferLimit:MAX_GPU_BYTES,surfaceBytes:device?device.canvas.width*device.canvas.height*4:0,lost:device?.lost??false};}

import { CandleStore, Viewport, candleGeometry, type Change } from './model';
export const theme={bg:'#090909',grid:'#1d1d1d',text:'#858585',up:'#58a65c',down:'#ad5858'};
// One instanced draw, two rectangles per visible candle. Coordinates are CSS pixels.
export const vertexShader=`#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 rect;
layout(location=2) in float rising;
uniform vec2 resolution;
out float up;
void main(){vec2 p=rect.xy+corner*rect.zw;gl_Position=vec4(p.x/resolution.x*2.-1.,1.-p.y/resolution.y*2.,0,1);up=rising;}`;
export const fragmentShader=`#version 300 es
precision mediump float;
in float up;
out vec4 color;
void main(){color=vec4(mix(vec3(.6784,.3451,.3451),vec3(.3451,.6510,.3608),up),1.);}`;
export interface RenderLayer { invalidate(change?:Change):void; render(geometry:boolean):void; dispose():void }
export class Renderer implements RenderLayer {
  readonly canvas=document.createElement('canvas');readonly overlay=document.createElement('canvas');
  private gl:WebGL2RenderingContext;private ctx:CanvasRenderingContext2D;
  private loss:WEBGL_lose_context|null;private resolution:WebGLUniformLocation|null=null;private program!:WebGLProgram;private vao!:WebGLVertexArrayObject;private buffer!:WebGLBuffer;private corners!:WebGLBuffer;
  private geometry=new Float32Array(5002*10);private start=-1;private end=-1;private changedFirst=Infinity;private changedLast=-1;private full=true;
  private width=1;private height=1;private dpr=1;private lost=false;
  crosshair:{x:number;y:number}|null=null;
  stats={draws:0,uploads:0,bytes:0,contexts:1,restores:0};readonly gpu:string;
  private priceFormat=new Intl.NumberFormat('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
  private timeFormat=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
  private dateFormat=new Intl.DateTimeFormat('en-GB',{month:'short',day:'2-digit',timeZone:'UTC'});
  private onLost=(e:Event)=>{e.preventDefault();this.lost=true;this.capability('WebGL context lost · waiting for restoration');};
  private onRestored=()=>{this.lost=false;this.initialize();this.full=true;this.stats.restores++;this.capability('');this.invalidate();this.redraw();};
  constructor(private store:CandleStore,private viewport:Viewport,private capability:(message:string)=>void,private redraw:()=>void) {
    this.canvas.className='gpu';this.overlay.className='overlay';this.overlay.setAttribute('aria-label','Candlestick plot. Drag to pan; wheel to zoom.');this.overlay.tabIndex=0;
    const gl=this.canvas.getContext('webgl2',{antialias:false,alpha:false,depth:false,stencil:false,preserveDrawingBuffer:false});
    if(!gl)throw new Error('WebGL2 unavailable · enable browser hardware acceleration');
    this.gl=gl;this.loss=gl.getExtension('WEBGL_lose_context');const ctx=this.overlay.getContext('2d');if(!ctx)throw new Error('Canvas overlay unavailable');this.ctx=ctx;
    const debug=gl.getExtension('WEBGL_debug_renderer_info');this.gpu=debug?String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)):'Renderer identification unavailable';
    this.initialize();this.canvas.addEventListener('webglcontextlost',this.onLost);this.canvas.addEventListener('webglcontextrestored',this.onRestored);
  }
  private initialize(){const gl=this.gl;
    const compile=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)??'Shader compile failed');return shader;};
    const vs=compile(gl.VERTEX_SHADER,vertexShader),fs=compile(gl.FRAGMENT_SHADER,fragmentShader);this.program=gl.createProgram()!;gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('Candle shader link failed');
    this.resolution=gl.getUniformLocation(this.program,'resolution');this.vao=gl.createVertexArray()!;gl.bindVertexArray(this.vao);this.corners=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,this.corners);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    this.buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.geometry.byteLength,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,20,0);gl.vertexAttribDivisor(1,1);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,1,gl.FLOAT,false,20,16);gl.vertexAttribDivisor(2,1);gl.bindVertexArray(null);
  }
  resize(width:number,height:number){const dpr=Math.min(2,window.devicePixelRatio||1);if(width===this.width&&height===this.height&&dpr===this.dpr)return;this.width=width;this.height=height;this.dpr=dpr;for(const c of [this.canvas,this.overlay]){c.width=Math.round(width*dpr);c.height=Math.round(height*dpr);c.style.width=`${width}px`;c.style.height=`${height}px`;}this.viewport.resize(width,height);this.full=true;}
  invalidate(change?:Change){if(!change||change.structural)this.full=true;else{this.changedFirst=Math.min(this.changedFirst,change.first);this.changedLast=Math.max(this.changedLast,change.last);}}
  render(geometry:boolean){if(this.lost)return;const {gl,viewport:v,store:s}=this;
    if(geometry){const oldMin=v.min,oldMax=v.max;v.autoscale(s);if(v.min!==oldMin||v.max!==oldMax)this.full=true;
      const r=v.range(s.length);if(this.start!==r.start||this.end!==r.end)this.full=true;this.start=r.start;this.end=r.end;
      const first=this.full?r.start:Math.max(r.start,this.changedFirst),last=this.full?r.end:Math.min(r.end,this.changedLast+1);
      if(first<last){for(let i=first;i<last;i++)this.geometry.set(candleGeometry(s,v,i),(i-r.start)*10);const offset=(first-r.start)*10;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,offset*4,this.geometry.subarray(offset,(last-r.start)*10));this.stats.uploads++;this.stats.bytes+=(last-first)*40;}
      this.full=false;this.changedFirst=Infinity;this.changedLast=-1;
      gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.disable(gl.SCISSOR_TEST);gl.clearColor(9/255,9/255,9/255,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);const p=v.plot;gl.scissor(Math.round(p.x*this.dpr),Math.round((this.height-p.y-p.height)*this.dpr),Math.round(p.width*this.dpr),Math.round(p.height*this.dpr));gl.useProgram(this.program);gl.uniform2f(this.resolution,this.width,this.height);gl.bindVertexArray(this.vao);gl.drawArraysInstanced(gl.TRIANGLES,0,6,Math.max(0,r.end-r.start)*2);gl.bindVertexArray(null);this.stats.draws++;
    }
    this.labels();
  }
  private labels(){const {ctx:c,viewport:v,store:s}=this,p=v.plot;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.width,this.height);c.font='11px ui-monospace, SFMono-Regular, Consolas, monospace';c.lineWidth=1;c.textBaseline='middle';c.fillStyle=theme.text;
    const steps=Math.max(2,Math.floor(p.height/90));c.strokeStyle=theme.grid;
    for(let n=0;n<=steps;n++){const y=p.y+p.height*n/steps,price=v.price(y);c.beginPath();c.moveTo(p.x,Math.round(y)+.5);c.lineTo(p.x+p.width,Math.round(y)+.5);c.stroke();c.fillText(this.priceFormat.format(price),p.x+p.width+7,y);}
    const r=v.range(s.length,0),stride=Math.max(1,Math.ceil(100/v.spacing));
    c.textAlign='center';
    for(let i=Math.ceil(r.start/stride)*stride;i<r.end;i+=stride){const x=v.x(i);if(x<p.x||x>p.x+p.width)continue;c.strokeStyle=theme.grid;c.beginPath();c.moveTo(Math.round(x)+.5,p.y);c.lineTo(Math.round(x)+.5,p.y+p.height);c.stroke();c.fillStyle=theme.text;c.fillText(this.timeFormat.format(s.time[i]),x,p.y+p.height+15);}
    c.textAlign='left';if(r.start<s.length)c.fillText(this.dateFormat.format(s.time[r.start])+' · UTC',p.x,this.height-6);
    if(s.length){const price=s.close[s.length-1],y=v.y(price);if(y>=p.y&&y<=p.y+p.height){c.strokeStyle=price>=s.open[s.length-1]?theme.up:theme.down;c.setLineDash([3,4]);c.beginPath();c.moveTo(p.x,y);c.lineTo(p.x+p.width,y);c.stroke();c.setLineDash([]);c.fillStyle='#202020';c.fillRect(p.x+p.width+1,y-9,78,18);c.fillStyle=theme.text;c.fillText(this.priceFormat.format(price),p.x+p.width+7,y);}}
    if(this.crosshair){const {x,y}=this.crosshair;if(x>=p.x&&x<=p.x+p.width&&y>=p.y&&y<=p.y+p.height){c.strokeStyle='#777';c.setLineDash([3,4]);c.beginPath();c.moveTo(x,p.y);c.lineTo(x,p.y+p.height);c.moveTo(p.x,y);c.lineTo(p.x+p.width,y);c.stroke();c.setLineDash([]);const i=Math.max(0,Math.min(s.length-1,Math.round(v.index(x))));c.fillStyle='#292929';c.fillRect(p.x+p.width+1,y-9,78,18);c.fillStyle='#c7c7c7';c.fillText(this.priceFormat.format(v.price(y)),p.x+p.width+7,y);if(s.length){c.fillStyle='#292929';c.fillRect(Math.max(p.x,Math.min(x-42,p.x+p.width-84)),p.y+p.height+5,84,18);c.fillStyle='#c7c7c7';c.textAlign='center';c.fillText(this.timeFormat.format(s.time[i]),Math.max(p.x+42,Math.min(x,p.x+p.width-42)),p.y+p.height+14);c.textAlign='left';}}}
  }
  contextLoss(restore:boolean){if(restore)this.loss?.restoreContext();else this.loss?.loseContext();}
  dispose(){const gl=this.gl;this.canvas.removeEventListener('webglcontextlost',this.onLost);this.canvas.removeEventListener('webglcontextrestored',this.onRestored);gl.deleteBuffer(this.buffer);gl.deleteBuffer(this.corners);gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();this.stats.contexts=0;}
}

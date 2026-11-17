import type {PrimitiveRenderContext} from 'openalgo-charts';

/** A resident mapping proof is independent of the camera. Capture all candle
 * knots touching the owned time interval, including interpolation brackets.
 * Never assume evenly spaced timestamps or infer identity from axis endpoints.
 */
export class WallLogicalMapping {
  private constructor(
    readonly from:number,readonly to:number,readonly firstIndex:number,
    private readonly knots:Float64Array,
  ){}

  static capture(rc:PrimitiveRenderContext,fromMs:number,toMs:number,maxKnots=8192):WallLogicalMapping|undefined {
    if(!Number.isFinite(fromMs)||!Number.isFinite(toMs)||toMs<fromMs||!Number.isSafeInteger(maxKnots)||maxKnots<2)return;
    const from=fromMs/1000,to=toMs/1000;
    const first=Math.floor(rc.dataLayer.timeToIndexFloat(from));
    const last=Math.ceil(rc.dataLayer.timeToIndexFloat(to));
    const count=Math.max(2,last-first+1);
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||last<first||count>maxKnots)return;
    const knots=new Float64Array(count);
    for(let n=0;n<count;n++){
      const value=rc.dataLayer.indexToTimeFloat(first+n);
      if(!Number.isFinite(value)||n>0&&value<=knots[n-1]!)return;
      knots[n]=value;
    }
    if(from<knots[0]!||to>knots[count-1]!)return;
    return new WallLogicalMapping(from,to,first,knots);
  }

  get bytes(){return this.knots.byteLength;}

  /** A prepend may translate every logical index while leaving all resident
   * geometry intact. An insertion/correction inside this interval invalidates
   * it. Checking every knot catches internal changes with unchanged endpoints.
   */
  offset(rc:PrimitiveRenderContext):number|undefined {
    const first=rc.dataLayer.timeToIndexFloat(this.knots[0]!);
    if(!Number.isSafeInteger(first))return;
    for(let n=0;n<this.knots.length;n++){
      if(rc.dataLayer.indexToTimeFloat(first+n)!==this.knots[n])return;
    }
    return first;
  }

  /** Relative logical coordinates retain sub-candle precision without Unix
   * timestamps in native path/GPU coordinates. No off-domain extrapolation.
   */
  logical(timeMs:number):number|undefined {
    const time=timeMs/1000;
    if(!Number.isFinite(time)||time<this.from||time>this.to)return;
    let lo=0,hi=this.knots.length-1;
    while(hi-lo>1){const mid=(lo+hi)>>>1;if(this.knots[mid]!<=time)lo=mid;else hi=mid;}
    return lo+(time-this.knots[lo]!)/(this.knots[hi]!-this.knots[lo]!);
  }

  /** Resolve camera projection without consulting any retained wall runs. */
  camera(rc:PrimitiveRenderContext){
    const offset=this.offset(rc);if(offset===undefined)return;
    const x=rc.timeScale.indexToX(offset),scale=rc.timeScale.indexToX(offset+1)-x;
    if(!Number.isFinite(x)||!Number.isFinite(scale)||scale<=0)return;
    return {x,scale};
  }
}

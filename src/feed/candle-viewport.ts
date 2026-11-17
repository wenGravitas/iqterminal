/** Axis interpolation and floor/ceil IPC can move an exact candle boundary by
 * a fraction of a millisecond (or one rounded millisecond). Normalize only that
 * boundary neighbourhood, preserving genuinely partial candles and all future
 * whitespace semantics. Do not round the source clock into a forming candle. */
export function snapCandleViewportBoundary(time:number,step:number){
 const nearest=Math.round(time/step)*step;return Math.abs(time-nearest)<=1?nearest:time;
}
export function pastCandleViewport(from:number,to:number,now:number,step:number){
 const end=Math.min(snapCandleViewportBoundary(to,step),Math.floor(now/step)*step);
 return {from:Math.floor(snapCandleViewportBoundary(from,step)/step)*step,to:Math.ceil(end/step)*step};
}

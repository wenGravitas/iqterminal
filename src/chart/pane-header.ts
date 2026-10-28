/** Shared horizontal budget for pane titles, source options and native actions. */
export const PANE_HEADER_ACTION_SPACE = 94;
export function paneHeaderSlots(plotWidth:number,preferredOptionsWidth:number){
  const optionsWidth=Math.min(preferredOptionsWidth,Math.max(0,plotWidth-PANE_HEADER_ACTION_SPACE-12-(plotWidth>=360?134:0)));
  return {optionsWidth,titleWidth:Math.min(430,plotWidth-PANE_HEADER_ACTION_SPACE-optionsWidth-12)};
}

/** Three venue controls, with icon-only buttons in compact panes. */
export function netPositioningOptionsWidth(plotWidth:number){return plotWidth<400?75:210;}

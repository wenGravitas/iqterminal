import {execFileSync} from 'node:child_process';
/** Narrow routing for browser sessions launched with --class=IQTerminalPerf. */
export async function routeTestBrowser(){
 try{
  for(let attempt=0;attempt<20;attempt++){
   const root=JSON.parse(execFileSync('i3-msg',['-t','get_tree'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
   const windows=[];function visit(node){if(node.window&&node.window_properties?.class==='IQTerminalPerf')windows.push(node.id);for(const child of [...(node.nodes??[]),...(node.floating_nodes??[])])visit(child);}visit(root);
   if(windows.length){for(const id of windows)execFileSync('i3-msg',[`[con_id="${id}"] move container to workspace number 9`],{stdio:'ignore'});return true;}
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  return false;
 }catch{return false;}
}

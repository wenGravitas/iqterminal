import {execFileSync} from 'node:child_process';
/** Verify routing before navigation; never silently continue on the working workspace. */
export async function routeTestBrowser(){
 if(!process.env.DISPLAY||process.env.IQ_BENCH_HEADLESS==='1')return false;
 const tree=()=>JSON.parse(execFileSync('i3-msg',['-t','get_tree'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
 function windows(root){
  const result=[];
  function visit(node,workspace){
   if(node.type==='workspace')workspace=node.num;
   const props=node.window_properties;
   if(node.window&&(props?.class==='IQTerminalPerf'||/^chromium \(\/tmp\/playwright_/.test(props?.instance??'')))result.push({id:node.id,workspace});
   for(const child of [...(node.nodes??[]),...(node.floating_nodes??[])])visit(child,workspace);
  }
  visit(root);return result;
 }
 for(let attempt=0;attempt<20;attempt++){
  const found=windows(tree());
  if(found.length){
   for(const win of found)if(win.workspace!==9){
    const reply=JSON.parse(execFileSync('i3-msg',[`[con_id="${win.id}"] move container to workspace number 9`],{encoding:'utf8'}));
    if(reply.some(item=>!item.success))throw new Error('i3 rejected test browser routing to workspace 9');
   }
   const verified=windows(tree());
   if(verified.length&&verified.every(win=>win.workspace===9))return true;
  }
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw new Error('Test browser workspace 9 could not be verified; refusing to navigate');
}

import {execFileSync} from 'node:child_process';

/** Fail before opening headed test windows if i3 routing was lost on reload. */
export default function verifyTestBrowserWorkspace(config){
 const headed=config.projects.filter(project=>project.use.headless===false);
 if(!headed.length||!process.env.DISPLAY||!process.env.I3SOCK)return;
 const loaded=execFileSync('i3-msg',['-t','get_config'],{encoding:'utf8'});
 const rules=loaded.split('\n').map(line=>line.trim());
 for(const rule of ['assign [class="^IQTerminalPerf$"] 9','no_focus [class="^IQTerminalPerf$"]']){
  if(!rules.includes(rule))throw new Error(`Refusing to launch headed browsers: missing loaded i3 rule: ${rule}`);
 }
 for(const project of headed){
  if(!project.use.launchOptions?.args?.includes('--class=IQTerminalPerf'))throw new Error('Refusing to launch headed browser without the workspace 9 class');
 }
}

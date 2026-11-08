import {execFileSync} from 'node:child_process';
export const testBrowserArgs=['--class=IQTerminalPerf','--ozone-platform=x11'];
export function verifyHeadedBrowser(options={},env=process.env,readConfig=()=>execFileSync('i3-msg',['-t','get_config'],{encoding:'utf8'})){
 if(options.headless!==false)return;
 // Fail before Chromium maps any window. Headed runs require a deliberate opt-in.
 if(env.IQ_TEST_HEADED!=='workspace9')throw new Error('Refusing headed test browser: tests default to headless; IQ_TEST_HEADED=workspace9 is required');
 if(!env.DISPLAY)return;
 // An i3 socket can be omitted by a runner; detect the session rather than bypass routing.
 if(!env.I3SOCK&&!env.SWAYSOCK&&!/i3/i.test(env.XDG_CURRENT_DESKTOP??'')){
  try{execFileSync('i3-msg',['-t','get_version'],{stdio:'ignore'});}catch{return;}
 }
 const rules=readConfig().split('\n').map(line=>line.trim());
 for(const rule of ['assign [class="^IQTerminalPerf$"] 9','no_focus [class="^IQTerminalPerf$"]','assign [instance="^chromium \\(/tmp/playwright_"] 9','no_focus [instance="^chromium \\(/tmp/playwright_"]']){
  if(!rules.includes(rule))throw new Error(`Refusing to launch headed browsers: missing loaded i3 rule: ${rule}`);
 }
 for(const arg of testBrowserArgs)if(!options.args?.includes(arg))throw new Error(`Refusing to launch headed browser without ${arg}`);
}
/** Fail before opening headed test windows if routing was lost on reload. */
export default function verifyTestBrowserWorkspace(config){
 for(const project of config.projects)verifyHeadedBrowser({...project.use.launchOptions,headless:project.use.headless});
}

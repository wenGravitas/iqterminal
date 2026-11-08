import {execFileSync} from 'node:child_process';
export const testBrowserArgs=['--class=IQTerminalPerf','--name=IQTerminalPerf','--ozone-platform=x11'];
export function verifyHeadedBrowser(options={},env=process.env,readConfig=()=>execFileSync('i3-msg',['-t','get_config'],{encoding:'utf8'})){
 if(options.headless!==false)return;
 // Fail before Chromium maps any window. Headed runs require a deliberate opt-in.
 if(env.IQ_TEST_HEADED!=='workspace9')throw new Error('Refusing headed test browser: tests default to headless; IQ_TEST_HEADED=workspace9 is required');
 if(!env.DISPLAY)throw new Error('Refusing headed test browser: DISPLAY is unavailable');
 // Missing desktop metadata must never bypass the loaded-rule check.
 let loaded;try{loaded=readConfig();}catch{throw new Error('Refusing headed test browser: cannot verify loaded i3 routing');}
 const rules=loaded.split('\n').map(line=>line.trim());
 for(const rule of ['assign [instance="^IQTerminalPerf$"] 9','no_focus [instance="^IQTerminalPerf$"]','assign [class="^IQTerminalPerf$"] 9','no_focus [class="^IQTerminalPerf$"]','assign [instance="^chromium \\(/tmp/playwright_"] 9','no_focus [instance="^chromium \\(/tmp/playwright_"]']){
  if(!rules.includes(rule))throw new Error(`Refusing to launch headed browsers: missing loaded i3 rule: ${rule}`);
 }
 for(const arg of testBrowserArgs)if(!options.args?.includes(arg))throw new Error(`Refusing to launch headed browser without ${arg}`);
}
/** Fail before opening headed test windows if routing was lost on reload. */
export default function verifyTestBrowserWorkspace(config){
 for(const project of config.projects)verifyHeadedBrowser({...project.use.launchOptions,headless:project.use.headless});
}

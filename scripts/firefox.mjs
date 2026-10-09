import {spawn} from 'node:child_process';import{writeFile}from'node:fs/promises';
// System Firefox can differ from Playwright's patched browser. A native headless
// screenshot smoke is kept distinct from Chromium's interactive checks.
const args=['--headless','--no-remote','--profile','/tmp/basis-firefox-profile','--window-size','1366,768','--screenshot',process.cwd()+'/artifacts/firefox.png','http://127.0.0.1:4173/?fixture=1'];
const proc=spawn('/usr/bin/firefox',args,{env:{...process.env,MOZ_HEADLESS:'1'}});let log='';proc.stdout.on('data',d=>log+=d);proc.stderr.on('data',d=>log+=d);const timeout=setTimeout(()=>proc.kill(),30000);await new Promise(r=>proc.on('exit',r));clearTimeout(timeout);await writeFile('artifacts/firefox.log',log);console.log(log);

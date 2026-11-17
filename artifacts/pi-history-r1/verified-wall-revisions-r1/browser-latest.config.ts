import {defineConfig} from '@playwright/test';
const root='/home/daz/workarea/iqterminal-perf-history',out=root+'/artifacts/pi-history-r1/verified-wall-revisions-r1';
export default defineConfig({testDir:root+'/tests/browser',testMatch:'order-walls-ui.spec.ts',workers:1,retries:0,timeout:30000,
 globalSetup:root+'/scripts/test-browser-i3-setup.mjs',outputDir:out+'/browser-output-latest',
 use:{baseURL:'http://127.0.0.1:4192',headless:true,viewport:{width:1366,height:768},launchOptions:{executablePath:'/usr/bin/chromium',headless:true,args:['--ozone-platform=headless','--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']}},
 webServer:{command:'pnpm exec vite preview --host 127.0.0.1 --port 4192 --strictPort --outDir '+out+'/dist',cwd:root,url:'http://127.0.0.1:4192',reuseExistingServer:false},
 reporter:[['list'],['json',{outputFile:out+'/browser-results-latest.json'}]]});

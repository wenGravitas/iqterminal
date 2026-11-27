import base from '../../playwright.config';
import {defineConfig} from '@playwright/test';
/** Isolated headless module server; never reuses or replaces the user's client. */
export default defineConfig({...base,testDir:'.',testMatch:['cvd-history-owner.spec.ts','cvd-projection-cache.spec.ts','cvd-tiered-chart.spec.ts'],
 globalSetup:'../../scripts/test-browser-i3-setup.mjs',
 outputDir:'../../artifacts/cvd-history-browser',
 use:{...base.use,baseURL:'http://127.0.0.1:5185',headless:true,launchOptions:{...base.use?.launchOptions,args:[...(base.use?.launchOptions?.args??[]).filter(a=>!a.startsWith('--ozone-platform=')),'--ozone-platform=headless']}},
 webServer:{command:'VITE_DATA_MODE=staging VITE_OI_HISTORY=0 VITE_CVD_TIERED_HISTORY=1 pnpm exec vite --mode staging --host 127.0.0.1 --port 5185 --strictPort',cwd:new URL('../../',import.meta.url).pathname,url:'http://127.0.0.1:5185',reuseExistingServer:false},
 reporter:[['list'],['json',{outputFile:new URL('../../artifacts/cvd-history-browser-results.json',import.meta.url).pathname}]],
});

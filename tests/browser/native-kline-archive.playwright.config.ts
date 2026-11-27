import base from '../../playwright.config';
import {defineConfig} from '@playwright/test';
export default defineConfig({...base,testDir:'.',testMatch:['native-kline-archive.spec.ts'],globalSetup:'../../scripts/test-browser-i3-setup.mjs',outputDir:'../../artifacts/native-kline-archive-browser',
 use:{...base.use,baseURL:'http://127.0.0.1:5186',headless:true,launchOptions:{...base.use?.launchOptions,args:[...(base.use?.launchOptions?.args??[]).filter(a=>!a.startsWith('--ozone-platform=')),'--ozone-platform=headless']}},
 webServer:{command:'VITE_DATA_MODE=staging VITE_HISTORY_TILES=1 VITE_NATIVE_CANDLE_ARCHIVE=1 pnpm exec vite --mode staging --host 127.0.0.1 --port 5186 --strictPort',cwd:new URL('../../',import.meta.url).pathname,url:'http://127.0.0.1:5186',reuseExistingServer:false},reporter:[['list'],['json',{outputFile:new URL('../../artifacts/native-kline-archive-browser-results.json',import.meta.url).pathname}]]});

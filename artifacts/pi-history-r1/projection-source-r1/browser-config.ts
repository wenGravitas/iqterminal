import {defineConfig} from '@playwright/test';
import base from './playwright.pi-history.config';
export default defineConfig({...base,testMatch:['wall-projection-source.spec.ts','native-candle-history.spec.ts'],use:{...base.use,baseURL:'http://127.0.0.1:4201',headless:true,launchOptions:{...base.use?.launchOptions,args:['--ozone-platform=headless','--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}},reporter:[['list'],['json',{outputFile:'artifacts/pi-history-r1/projection-source-r1/browser-results.json'}]]});

import { defineConfig } from '@playwright/test';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';
export default defineConfig({testDir:'tests/browser',workers:1,use:{baseURL,viewport:{width:1366,height:768},launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']}},webServer:{command:'pnpm preview --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:true},reporter:[['list'],['json',{outputFile:'artifacts/browser-results.json'}]]});

import {defineConfig} from '@playwright/test';
import {twoChartWorkspaceState} from './tests/browser/workspace-state';
const baseURL='http://127.0.0.1:4202';
export default defineConfig({globalSetup:'./scripts/test-browser-i3-setup.mjs',testDir:'tests/browser',workers:1,timeout:45000,use:{baseURL,headless:true,storageState:twoChartWorkspaceState(baseURL),viewport:{width:1366,height:768},launchOptions:{executablePath:'/usr/bin/chromium',args:['--class=IQTerminalPerf','--name=IQTerminalPerf','--ozone-platform=headless','--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}},reporter:[['list'],['json',{outputFile:'artifacts/pi-history-integration-startup-r1/browser-results.json'}]],outputDir:'artifacts/pi-history-integration-startup-r1/browser-test-output'});

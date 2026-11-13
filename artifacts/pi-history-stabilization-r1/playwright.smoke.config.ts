import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
import prior from '../../playwright.pi-history.config';
export default defineConfig({...prior,globalSetup:resolve('scripts/test-browser-i3-setup.mjs'),testDir:resolve('tests/browser'),workers:1,use:{...prior.use,baseURL:'http://127.0.0.1:4201',headless:true},reporter:[['list'],['json',{outputFile:'artifacts/pi-history-stabilization-r1/browser-recovery-results.json'}]],outputDir:'artifacts/pi-history-stabilization-r1/browser-test-output'});

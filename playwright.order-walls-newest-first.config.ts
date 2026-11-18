import {defineConfig} from '@playwright/test';
import base from './playwright.config';
import {resolve} from 'node:path';
process.env.IQ_WALL_NEWEST_FIRST_BROWSER='1';
export default defineConfig({...base,globalSetup:resolve('scripts/test-browser-i3-setup.mjs'),testDir:resolve('tests/browser'),testMatch:'wall-projection-source.spec.ts',timeout:60000,
 use:{...base.use,baseURL:'http://127.0.0.1:4186'},
 webServer:{command:'pnpm exec vite preview --mode staging --host 127.0.0.1 --port 4186 --strictPort --outDir artifacts/order-walls-newest-first/dist',url:'http://127.0.0.1:4186',reuseExistingServer:false},
 outputDir:resolve('artifacts/order-walls-newest-first/browser'),reporter:[['list'],['json',{outputFile:resolve('artifacts/order-walls-newest-first/browser-results.json')}]]});

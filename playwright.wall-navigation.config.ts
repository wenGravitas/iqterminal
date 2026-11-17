import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,testMatch:'wall-retained-navigation.spec.ts',
 use:{...base.use,baseURL:'http://127.0.0.1:4189',headless:true},
 webServer:{command:'pnpm exec vite preview --outDir dist-wall-navigation --host 127.0.0.1 --port 4189 --strictPort',url:'http://127.0.0.1:4189',reuseExistingServer:false},
 reporter:[['list'],['json',{outputFile:'artifacts/persistent-wall-navigation/compiled-browser-results.json'}]],
});

import {chromium as browserType} from '@playwright/test';
import {testBrowserArgs,verifyHeadedBrowser} from './test-browser-i3-setup.mjs';
/** All standalone headed launches pass the same pre-map guard as Playwright. */
export const chromium={async launch(options={}){
 const args=[...(options.args??[]).filter(arg=>!/^--(class|name|ozone-platform)=/.test(arg)),...testBrowserArgs];
 verifyHeadedBrowser(options);
 const guarded={...options,headless:true,args};
 return browserType.launch(guarded);
}};

import { chromium } from '@playwright/test';
export const url=process.env.TERMINAL_URL||'http://127.0.0.1:4173';
export async function launch(software=true){return chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl',...(software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});}

import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base, testMatch: 'workspace-borders.spec.ts', grep: /Pi Chromium/, timeout: 60000,
  use: { ...base.use, headless: true, launchOptions: { executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--ozone-platform=headless', '--enable-gpu', '--use-gl=angle', '--use-angle=gles', '--ignore-gpu-blocklist'] } },
  reporter: [['list'], ['json', { outputFile: 'artifacts/workspace-borders-pi-gpu-results.json' }]],
});

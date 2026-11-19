import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config';
export default defineConfig({ ...base, testDir: '../../tests/browser', testMatch: 'trading-foundation.spec.ts',
  globalSetup: '../test-browser-i3-setup.mjs', use: { ...base.use, baseURL: 'http://127.0.0.1:4197', storageState: undefined },
  webServer: { command: 'pnpm preview --host 127.0.0.1 --port 4197 --strictPort', url: 'http://127.0.0.1:4197', reuseExistingServer: false },
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL('../../artifacts/trading-foundation/browser-results.json', import.meta.url)) }]],
});

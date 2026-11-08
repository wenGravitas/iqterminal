import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4176';

export default defineConfig({globalSetup:'./scripts/test-browser-i3-setup.mjs',
  testDir: './tests/browser',
  workers: 1,
  use: {
    baseURL,
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--class=IQTerminalPerf','--name=IQTerminalPerf','--ozone-platform=x11', '--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'VITE_DATA_MODE=staging VITE_DIAGNOSTICS=1 pnpm dev --host 127.0.0.1 --port 4176 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
  },
  reporter: [['list'], ['json', { outputFile: process.env.FOOTPRINT_STAGING_RESULTS ?? 'artifacts/footprint-totals/staging-worker-results.json' }]],
});

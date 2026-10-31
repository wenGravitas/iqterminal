import { defineConfig } from '@playwright/test';
import { twoChartWorkspaceState } from './tests/browser/workspace-state';

const baseURL = 'http://127.0.0.1:4177';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: {
    baseURL,
    storageState: twoChartWorkspaceState(baseURL),
    viewport: { width: 1366, height: 768 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: { command: 'pnpm exec vite preview --host 127.0.0.1 --port 4177 --outDir /tmp/iqterminal-pane-r2-staging-dist', url: baseURL, reuseExistingServer: false },
  reporter: [['list'], ['json', { outputFile: process.env.R2_STAGING_RESULTS ?? 'artifacts/browser-results-r2-staging-watch.json' }]],
});

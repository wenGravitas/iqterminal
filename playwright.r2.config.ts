import { defineConfig } from '@playwright/test';
import { twoChartWorkspaceState } from './tests/browser/workspace-state';

const baseURL = 'http://127.0.0.1:4175';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: {
    baseURL,
    storageState: twoChartWorkspaceState(baseURL),
    viewport: { width: 1366, height: 768 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  // R2 fixture builds live outside `dist`, so normal builds never switch the
  // default product output into diagnostics mode.
  webServer: { command: 'pnpm exec vite preview --host 127.0.0.1 --port 4175 --outDir /tmp/iqterminal-pane-r2-dist', url: baseURL, reuseExistingServer: false },
  reporter: [['list'], ['json', { outputFile: process.env.R2_BROWSER_RESULTS ?? 'artifacts/browser-results-r2-final.json' }]],
});

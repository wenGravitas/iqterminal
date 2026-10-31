import { defineConfig } from '@playwright/test';
import { twoChartWorkspaceState } from './tests/browser/workspace-state';

const baseURL = 'http://127.0.0.1:4193';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['connection-status.spec.ts', 'market-pulse.spec.ts', 'footer.spec.ts', 'theme.spec.ts'],
  workers: 1,
  use: {
    baseURL,
    storageState: twoChartWorkspaceState(baseURL),
    viewport: { width: 1366, height: 768 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'VITE_DATA_MODE=staging VITE_DIAGNOSTICS=1 pnpm dev --host 127.0.0.1 --port 4193 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
  },
  reporter: 'list',
});

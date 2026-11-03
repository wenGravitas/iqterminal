import { defineConfig } from '@playwright/test';
import { twoChartWorkspaceState } from './tests/browser/workspace-state';

const enabled = process.env.IQTERMINAL_ENABLE_LIVE_ORDER_WALLS_PROBE === '1';
if (!enabled) {
  throw new Error('Set IQTERMINAL_ENABLE_LIVE_ORDER_WALLS_PROBE=1 to run live Order Walls profiling. This config does not start services.');
}

const baseURL = process.env.IQTERMINAL_ORDER_WALLS_BASE_URL ?? 'http://127.0.0.1:5173';
export default defineConfig({
  testDir: './tools/profile',
  testMatch: '**/order-walls-live-probe.playwright.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 5_100_000,
  use: {
    baseURL,
    storageState: twoChartWorkspaceState(baseURL),
    viewport: { width: 1920, height: 1080 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] },
  },
  reporter: 'list',
});

import { defineConfig, loadEnv, type UserConfig } from 'vite';
export default defineConfig(({ mode }) => {
  const staging = mode === 'staging' || process.env.VITE_DATA_MODE === 'staging' || loadEnv(mode, process.cwd()).VITE_DATA_MODE === 'staging';
  return ({
  worker: { format: 'es' },
  // Staging proxy is development-only and guarded against CLI --host overrides.
  plugins: staging ? [{ name: 'staging-loopback-only', configResolved(config) {
    if (config.server.host !== '127.0.0.1' && config.server.host !== 'localhost') throw new Error('Staging data mode requires a loopback Vite host');
  } }] : [],
  server: staging ? { host: '127.0.0.1', port: 5173, strictPort: true, proxy: {
    '/market-data': { target: 'http://127.0.0.1:18780', ws: true, rewrite: path => path.replace(/^\/market-data/, '') },
  } } : undefined,
  test: { include: ['tests/**/*.test.ts'] },
}) as UserConfig;
});

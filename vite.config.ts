import { Agent } from 'node:http';
import { defineConfig, loadEnv, type UserConfig } from 'vite';
export default defineConfig(({ mode }) => {
  const staging = mode === 'staging' || process.env.VITE_DATA_MODE === 'staging' || loadEnv(mode, process.cwd()).VITE_DATA_MODE === 'staging';
  const liquidationTarget=process.env.VITE_LIQUIDATION_API_URL;
  if(liquidationTarget){const target=new URL(liquidationTarget);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname))throw Error('Liquidation development target must be loopback HTTP');}
  const currentBookAgent=staging?new Agent({keepAlive:true,maxSockets:4,maxFreeSockets:4,timeout:15000}):undefined;
  const historyAgent=staging?new Agent({keepAlive:true,maxSockets:4,maxFreeSockets:4,timeout:60000}):undefined;
  return ({
  worker: { format: 'es' },
  // Staging proxy is development-only and guarded against CLI --host overrides.
  plugins: staging ? [{ name: 'staging-loopback-only', configureServer(server){server.httpServer?.once('close',()=>{historyAgent?.destroy();currentBookAgent?.destroy();});}, configResolved(config) {
    if (config.server.host !== '127.0.0.1' && config.server.host !== 'localhost') throw new Error('Staging data mode requires a loopback Vite host');
  } }] : [],
  server: staging ? { host: '127.0.0.1', port: 5173, strictPort: true, proxy: {
    // Current-book recovery must not queue behind long historical reads.
    '/market-data/v1/liquidations/stream': { target: liquidationTarget??'http://127.0.0.1:18781', agent:false, ws:true, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/liquidations': { target: liquidationTarget??'http://127.0.0.1:18780', agent:historyAgent, proxyTimeout:30000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/effort-result': { target: 'http://127.0.0.1:18781', agent:currentBookAgent, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/health': { target: 'http://127.0.0.1:18781', agent:currentBookAgent, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/depth-matrix': { target: 'http://127.0.0.1:18781', agent:currentBookAgent, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/footprints': { target: 'http://127.0.0.1:18781', agent:currentBookAgent, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/native-candles': { target: 'http://127.0.0.1:18781', agent:currentBookAgent, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/stream': { target: 'http://127.0.0.1:18781', agent:false, ws:true, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data': { target: 'http://127.0.0.1:18780', agent:historyAgent, ws: true, rewrite: path => path.replace(/^\/market-data/, '') },
  } } : undefined,
  test: { include: ['tests/**/*.test.ts'] },
}) as UserConfig;
});

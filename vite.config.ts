import {StagingProxyBudget} from './scripts/staging-proxy-budget.ts';
import {observeStagingProxy} from './scripts/staging-proxy-observability.ts';
import { Agent } from 'node:http';
import { defineConfig, loadEnv, type UserConfig,type ProxyOptions } from 'vite';
export default defineConfig(({ mode }) => {
  const staging = mode === 'staging' || process.env.VITE_DATA_MODE === 'staging' || loadEnv(mode, process.cwd()).VITE_DATA_MODE === 'staging';
  const liquidationTarget=process.env.VITE_LIQUIDATION_API_URL;
  if(liquidationTarget){const target=new URL(liquidationTarget);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname))throw Error('Liquidation development target must be loopback HTTP');}
  const currentTarget=process.env.VITE_CURRENT_API_URL??'http://127.0.0.1:18781';
  {const target=new URL(currentTarget);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('Current development target must be an unauthenticated loopback HTTP origin');}
  const historyTarget=process.env.VITE_HISTORY_API_URL;
  if(historyTarget){const target=new URL(historyTarget);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('History development target must be an unauthenticated loopback HTTP origin');}
  const nativeHistoryTarget=process.env.VITE_NATIVE_HISTORY_API_URL;
  if(nativeHistoryTarget){const target=new URL(nativeHistoryTarget);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname))throw Error('Native history development target must be loopback HTTP');}
  const currentBookAgent=staging?new Agent({keepAlive:true,maxSockets:4,maxTotalSockets:4,maxFreeSockets:4,timeout:15000}):undefined;
  // Both historical lanes may use two sockets; shared admission below caps
  // their aggregate at three and retains room for independent native reads.
  const historyAgent=staging?new Agent({keepAlive:true,maxSockets:2,maxTotalSockets:2,maxFreeSockets:2,timeout:60000}):undefined;
  const nativeHistoryAgent=staging?new Agent({keepAlive:true,maxSockets:2,maxTotalSockets:2,maxFreeSockets:2,timeout:60000}):undefined;
  const proxy:Record<string,string|ProxyOptions>|undefined=staging?{
    // Current-book recovery must not queue behind long historical reads.
    '/market-data/v1/level-watches/stream': { target: currentTarget, agent:false, ws:true, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/level-watches': { target: currentTarget, agent:currentBookAgent, configure:observeStagingProxy, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/liquidations/stream': { target: liquidationTarget??currentTarget, agent:false, ws:true, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/liquidations': { target: liquidationTarget??historyTarget??'http://127.0.0.1:18780', agent:historyAgent, configure:observeStagingProxy, proxyTimeout:30000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v2/history/walls/reader': { target: currentTarget, agent:currentBookAgent, configure:observeStagingProxy, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v2/history/walls/preparation': { target: currentTarget, agent:currentBookAgent, configure:observeStagingProxy, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v2/history/footprint-current': { target: currentTarget, agent:currentBookAgent, configure:observeStagingProxy, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v2/history/current': { target: currentTarget, agent:currentBookAgent, configure:observeStagingProxy, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v2/history/health': { target: currentTarget, agent:currentBookAgent, configure:observeStagingProxy, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/order-walls/archive/current': { target: currentTarget, agent:currentBookAgent, configure:observeStagingProxy, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/effort-result': { target: currentTarget, agent:currentBookAgent, configure:observeStagingProxy, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/health': { target: currentTarget, agent:currentBookAgent, configure:observeStagingProxy, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/depth-matrix': { target: currentTarget, agent:currentBookAgent, configure:observeStagingProxy, proxyTimeout:12000, rewrite: path => path.replace(/^\/market-data/, '') },
    // Candle/Footprint snapshots are history responses. Keep their transfers
    // off the live SSH TCP connection so they cannot delay stream heartbeats.
    '/market-data/v1/footprints': { target: historyTarget??'http://127.0.0.1:18780', agent:historyAgent, configure:observeStagingProxy, proxyTimeout:60000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/native-candles': { target: nativeHistoryTarget??historyTarget??'http://127.0.0.1:18780', agent:nativeHistoryAgent, configure:observeStagingProxy, proxyTimeout:60000, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data/v1/stream': { target: currentTarget, agent:false, ws:true, rewrite: path => path.replace(/^\/market-data/, '') },
    '/market-data': { target: historyTarget??'http://127.0.0.1:18780', agent:historyAgent, configure:observeStagingProxy, ws: true, rewrite: path => path.replace(/^\/market-data/, '') },
  }:undefined;
  const proxyBudget=staging?new StagingProxyBudget(request=>{
    const match=Object.entries(proxy!).find(([path])=>request.url?.startsWith(path));
    const option=match?.[1];if(!option||typeof option==='string')return;
    return option.agent===currentBookAgent?'current':option.agent===nativeHistoryAgent?'native':option.agent===historyAgent?'bulk':undefined;
  }):undefined;
  return ({
  worker: { format: 'es' },
  // Staging proxy is development-only and guarded against CLI --host overrides.
  plugins: staging ? [{ name: 'staging-loopback-only', api:{proxyBudget}, configureServer(server){server.middlewares.use(proxyBudget!.middleware);server.httpServer?.once('close',()=>{proxyBudget?.close();historyAgent?.destroy();nativeHistoryAgent?.destroy();currentBookAgent?.destroy();});}, configurePreviewServer(server){server.middlewares.use(proxyBudget!.middleware);server.httpServer.once('close',()=>{proxyBudget?.close();historyAgent?.destroy();nativeHistoryAgent?.destroy();currentBookAgent?.destroy();});}, configResolved(config) {
    if (config.server.host !== '127.0.0.1' && config.server.host !== 'localhost') throw new Error('Staging data mode requires a loopback Vite host');
  } }] : [],
  server: staging ? { host: '127.0.0.1', port: 5173, strictPort: true, proxy } : undefined,
  test: { include: ['tests/**/*.test.ts'] },
}) as UserConfig;
});

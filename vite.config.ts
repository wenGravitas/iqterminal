import {StagingProxyBudget} from './scripts/staging-proxy-budget.ts';
import {observeStagingProxy} from './scripts/staging-proxy-observability.ts';
import stagingProxyRoutes from './scripts/staging-proxy-routes.json' with { type: 'json' };
import { Agent } from 'node:http';
import { defineConfig, loadEnv, type UserConfig,type ProxyOptions } from 'vite';
export default defineConfig(({ mode }) => {
  const staging = mode === 'staging' || process.env.VITE_DATA_MODE === 'staging' || loadEnv(mode, process.cwd()).VITE_DATA_MODE === 'staging';
  const liquidationTarget=process.env.VITE_LIQUIDATION_API_URL;
  if(liquidationTarget){const target=new URL(liquidationTarget);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname))throw Error('Liquidation development target must be loopback HTTP');}
  const watchTarget=process.env.VITE_WATCH_API_URL;
  if(watchTarget){const target=new URL(watchTarget);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('Watch development target must be an unauthenticated loopback HTTP origin');}
  const currentTarget=process.env.VITE_CURRENT_API_URL??'http://127.0.0.1:18781';
  {const target=new URL(currentTarget);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('Current development target must be an unauthenticated loopback HTTP origin');}
  const historyTarget=process.env.VITE_HISTORY_API_URL;
  if(historyTarget){const target=new URL(historyTarget);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('History development target must be an unauthenticated loopback HTTP origin');}
  const wallHistoryTarget=process.env.VITE_WALL_HISTORY_API_URL,wallControlTarget=process.env.VITE_WALL_CONTROL_API_URL;
  if(Boolean(wallHistoryTarget)!==Boolean(wallControlTarget))throw Error('Prepared wall history and control targets must be configured together');
  for(const value of [wallHistoryTarget,wallControlTarget])if(value){const target=new URL(value);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('Prepared wall development targets must be unauthenticated loopback HTTP origins');}
  const nativeHistoryTarget=process.env.VITE_NATIVE_HISTORY_API_URL;
  if(nativeHistoryTarget){const target=new URL(nativeHistoryTarget);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname))throw Error('Native history development target must be loopback HTTP');}
  const currentBookAgent=staging?new Agent({keepAlive:true,maxSockets:4,maxTotalSockets:4,maxFreeSockets:4,timeout:15000}):undefined;
  // Both historical lanes may use two sockets; shared admission below caps
  // their aggregate at three and retains room for independent native reads.
  const historyAgent=staging?new Agent({keepAlive:true,maxSockets:2,maxTotalSockets:2,maxFreeSockets:2,timeout:60000}):undefined;
  const nativeHistoryAgent=staging?new Agent({keepAlive:true,maxSockets:2,maxTotalSockets:2,maxFreeSockets:2,timeout:60000}):undefined;
  const targets={
    current:currentTarget,
    history:historyTarget??'http://127.0.0.1:18780',
    wallHistory:wallHistoryTarget??'http://127.0.0.1:18882',
    wallControl:wallControlTarget??currentTarget,
    nativeHistory:nativeHistoryTarget??historyTarget??'http://127.0.0.1:18780',
    liquidations:liquidationTarget??historyTarget??'http://127.0.0.1:18780',
    liquidationStream:liquidationTarget??currentTarget,
    watch:watchTarget??currentTarget,
  } as const;
  const agents={current:currentBookAgent,history:historyAgent,native:nativeHistoryAgent} as const;
  type Route=typeof stagingProxyRoutes[number]&{upstream:keyof typeof targets;pool:keyof typeof agents|'none'};
  const proxy:Record<string,string|ProxyOptions>|undefined=staging?Object.fromEntries((stagingProxyRoutes as Route[]).map(route=>[
    route.path,{target:targets[route.upstream],...(route.pool==='none'?{agent:false}:{agent:agents[route.pool]}),
      ...(route.websocket?{ws:true}:{}),...(!route.websocket||route.pool!=='none'?{configure:observeStagingProxy,proxyTimeout:route.timeoutMs}:{}),
      rewrite:(path:string)=>path.replace(/^\/market-data/,'')},
  ])):undefined;
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

import {test,expect,vi,afterEach} from 'vitest';
import {loadConfigFromFile,type ProxyOptions} from 'vite';
import {resolve} from 'node:path';
afterEach(()=>vi.unstubAllEnvs());
test('isolated current and history targets keep lease/current routes coherent without changing admission agents',async()=>{
 vi.stubEnv('VITE_CURRENT_API_URL','http://127.0.0.1:18881');vi.stubEnv('VITE_HISTORY_API_URL','http://127.0.0.1:18880');
 const loaded=await loadConfigFromFile({command:'serve',mode:'staging'},resolve('vite.config.ts'));const p=loaded!.config.server!.proxy!;
 const current=['/market-data/v2/history/walls/reader','/market-data/v2/history/walls/preparation','/market-data/v2/history/health','/market-data/v1/order-walls/archive/current','/market-data/v1/stream','/market-data/v1/level-watches','/market-data/v1/level-watches/stream'];
 for(const path of current)expect((p[path] as ProxyOptions).target).toBe('http://127.0.0.1:18881');
 expect((p['/market-data'] as ProxyOptions).target).toBe('http://127.0.0.1:18880');
 expect((p[current[0]!] as ProxyOptions).agent).toBe((p[current[2]!] as ProxyOptions).agent);
 expect((p['/market-data'] as ProxyOptions).agent).not.toBe((p[current[0]!] as ProxyOptions).agent);
 expect((p['/market-data/v1/stream'] as ProxyOptions).ws).toBe(true);
});
test.each(['https://127.0.0.1:18881','http://example.com','http://u:p@localhost:18881','http://localhost:18881/path','http://localhost:18881/?x=1','http://localhost:18881/#x'])('rejects unsafe isolated current target %s',async target=>{
 vi.stubEnv('VITE_CURRENT_API_URL',target);
 await expect(loadConfigFromFile({command:'serve',mode:'staging'},resolve('vite.config.ts'))).rejects.toThrow('Current development target');
});

test('prepared wall data/control use dedicated transports while other feeds retain their targets',async()=>{
 vi.stubEnv('VITE_WALL_HISTORY_API_URL','http://127.0.0.1:18882');vi.stubEnv('VITE_WALL_CONTROL_API_URL','http://127.0.0.1:18883');
 const loaded=await loadConfigFromFile({command:'serve',mode:'staging'},resolve('vite.config.ts')),p=loaded!.config.server!.proxy!;
 expect((p['/market-data/v2/history/walls'] as ProxyOptions).target).toBe('http://127.0.0.1:18882');
 for(const path of ['reader','preparation'])expect((p['/market-data/v2/history/walls/'+path] as ProxyOptions).target).toBe('http://127.0.0.1:18883');
 expect((p['/market-data/v1/stream'] as ProxyOptions).target).toBe('http://127.0.0.1:18781');
 expect((p['/market-data/v1/native-candles'] as ProxyOptions).target).toBe('http://127.0.0.1:18780');
 expect((p['/market-data/v1/order-walls/archive/current'] as ProxyOptions).target).toBe('http://127.0.0.1:18781');
 expect((p['/market-data/v2/history/walls/reader'] as ProxyOptions).agent).not.toBe((p['/market-data/v2/history/walls'] as ProxyOptions).agent);
});
test.each(['https://127.0.0.1:18882','http://example.com','http://u:p@localhost:18882','http://localhost:18882/path','http://localhost:18882/?x=1','http://localhost:18882/#x'])('rejects unsafe prepared wall target %s',async target=>{
 vi.stubEnv('VITE_WALL_HISTORY_API_URL',target);vi.stubEnv('VITE_WALL_CONTROL_API_URL','http://127.0.0.1:18883');
 await expect(loadConfigFromFile({command:'serve',mode:'staging'},resolve('vite.config.ts'))).rejects.toThrow('Prepared wall development targets');
});
test('rejects half-configured prepared wall routing',async()=>{
 vi.stubEnv('VITE_WALL_HISTORY_API_URL','http://127.0.0.1:18882');
 await expect(loadConfigFromFile({command:'serve',mode:'staging'},resolve('vite.config.ts'))).rejects.toThrow('configured together');
});

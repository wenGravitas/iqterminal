import {defineConfig,mergeConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import base from './vite.config';
/** Explicit diagnostic build: both the real app and standalone renderer fixture.
 * It never replaces dist/ or changes the ordinary running preview. */
export default defineConfig(async env=>mergeConfig(await (typeof base==='function'?base(env):base),{
 define:{'import.meta.env.VITE_DIAGNOSTICS':JSON.stringify('1')},
 build:{outDir:'dist-wall-navigation',rollupOptions:{input:{app:fileURLToPath(new URL('./index.html',import.meta.url)),wallNavigation:fileURLToPath(new URL('./tests/browser/fixtures/wall-navigation.html',import.meta.url))}}},
}));

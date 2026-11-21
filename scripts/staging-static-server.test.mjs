import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { brotliCompressSync } from 'node:zlib';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import net from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStagingStaticServer, matchStagingRoute, stagingUpstreams } from './staging-static-server.mjs';
import stagingProxyRoutes from './staging-proxy-routes.json' with { type: 'json' };

const routes = [
  { path: '/market-data/v1/stream', upstream: 'current', pool: 'none', timeoutMs: 1000, websocket: true },
  { path: '/market-data/v1/health', upstream: 'current', pool: 'current', timeoutMs: 1000 },
  { path: '/market-data/v2/history/walls', upstream: 'wallHistory', pool: 'history', timeoutMs: 1000 },
  { path: '/market-data', upstream: 'history', pool: 'history', timeoutMs: 1000, websocket: true },
];

async function listening(server) {
  if (server.listening) return server.address();
  await once(server, 'listening'); return server.address();
}

async function close(server) {
  if (!server?.listening) return;
  server.close(); await once(server, 'close');
}

async function fixture(maxProxyBodyBytes) {
  const root = mkdtempSync(join(tmpdir(), 'iqterminal-static-server-'));
  const dist = join(root, 'dist'); mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>IQTerminal</title>');
  const asset = Buffer.from('export const release = true;');
  writeFileSync(join(dist, 'assets/app-AbCdEf0123.js'), asset);
  writeFileSync(join(dist, 'assets/app-AbCdEf0123.js.br'), brotliCompressSync(asset));
  const releaseFile = join(root, 'release.json'); writeFileSync(releaseFile, JSON.stringify({ releaseId: 'front-back' }));

  const upgrades = [], upgradedSockets = [], origins = []; let liveRequests = 0;
  const live = createHttpServer((request, response) => {
    liveRequests++;
    origins.push(request.headers.origin);
    const url = new URL(request.url ?? '/', 'http://upstream');
    if (url.pathname === '/v1/health') {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3', 'cache-control': 'no-store', 'server-timing': 'gateway;dur=4' });
      response.end(JSON.stringify({ retryable: true, path: url.pathname, query: url.search })); return;
    }
    response.writeHead(404); response.end('not found');
  });
  live.on('upgrade', (request, socket) => {
    origins.push(request.headers.origin);
    upgradedSockets.push(socket);
    const key = request.headers['sec-websocket-key'];
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    upgrades.push(request.url);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  const wall = createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://upstream');
    if (url.pathname === '/v2/history/walls') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.write('first'); setTimeout(() => response.end('second'), 20); return;
    }
    response.writeHead(404); response.end('not found');
  });
  live.listen(0, '127.0.0.1'); wall.listen(0, '127.0.0.1');
  const [liveAddress, wallAddress] = await Promise.all([listening(live), listening(wall)]);
  const server = createStagingStaticServer({ staticRoot: dist, releaseFile, routes,
    upstreams: { current: `http://127.0.0.1:${liveAddress.port}`, history: `http://127.0.0.1:${wallAddress.port}`,
      wallHistory: `http://127.0.0.1:${wallAddress.port}`, liquidationStream: `http://127.0.0.1:${liveAddress.port}` }, port: 0, maxProxyBodyBytes });
  const address = await listening(server);
  return { root, dist, server, live, wall, upgrades, upgradedSockets, origins, get liveRequests() { return liveRequests; }, base: `http://127.0.0.1:${address.port}` };
}

test('static output serves SPA routes, immutable compressed assets, revalidation, and release metadata', async t => {
  const f = await fixture(); t.after(async () => { f.upgradedSockets.forEach(socket => socket.destroy()); await close(f.server); await close(f.live); await close(f.wall); rmSync(f.root, { recursive: true, force: true }); });
  const page = await fetch(`${f.base}/chart/BTCUSDT`);
  assert.equal(page.status, 200); assert.equal(await page.text(), '<!doctype html><title>IQTerminal</title>');
  assert.match(page.headers.get('cache-control'), /no-cache/);
  const pageHead = await fetch(`${f.base}/`, { method: 'HEAD' });
  assert.equal(pageHead.status, 200); assert.equal(pageHead.headers.get('content-length'), String(Buffer.byteLength('<!doctype html><title>IQTerminal</title>')));
  const asset = await fetch(`${f.base}/assets/app-AbCdEf0123.js`, { headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(asset.status, 200); assert.equal(asset.headers.get('content-encoding'), 'br');
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal(await asset.text(), 'export const release = true;');
  const etag = page.headers.get('etag');
  const unchanged = await fetch(`${f.base}/`, { headers: { 'if-none-match': etag } });
  assert.equal(unchanged.status, 304);
  const release = await fetch(`${f.base}/__staging/release.json`);
  const metadata = await release.json();
  assert.equal(metadata.release.releaseId, 'front-back'); assert.equal(metadata.ok, true);
  assert.equal((await fetch(`${f.base}/assets/missing-12345678.js`)).status, 404);
});

test('same-origin API proxy rewrites only the prefix, preserves retry status, and streams wall history', async t => {
  const f = await fixture(); t.after(async () => { f.upgradedSockets.forEach(socket => socket.destroy()); await close(f.server); await close(f.live); await close(f.wall); rmSync(f.root, { recursive: true, force: true }); });
  const health = await fetch(`${f.base}/market-data/v1/health?scope=live`);
  assert.equal(health.status, 429); assert.equal(health.headers.get('retry-after'), '3');
  assert.match(health.headers.get('server-timing'), /gateway;dur=4/);
  assert.match(health.headers.get('server-timing'), /upstream;dur=/);
  assert.deepEqual(await health.json(), { retryable: true, path: '/v1/health', query: '?scope=live' });
  const wall = await fetch(`${f.base}/market-data/v2/history/walls?from=1&to=2`);
  assert.equal(wall.status, 200); assert.equal(await wall.text(), 'firstsecond');
});

test('proxy rejects request bodies above the configured request limit before forwarding', async t => {
  const f = await fixture(5); t.after(async () => { await close(f.server); await close(f.live); await close(f.wall); rmSync(f.root, { recursive: true, force: true }); });
  const response = await fetch(`${f.base}/market-data/v1/health`, { method: 'POST', body: '123456' });
  assert.equal(response.status, 413); assert.equal((await response.json()).retryable, undefined);
  assert.equal(f.liveRequests, 0);
});

test('WebSocket upgrade is proxied to its specific live route', async t => {
  const f = await fixture(); t.after(async () => { f.upgradedSockets.forEach(socket => socket.destroy()); await close(f.server); await close(f.live); await close(f.wall); rmSync(f.root, { recursive: true, force: true }); });
  const address = f.server.address();
  const socket = net.connect(address.port, '127.0.0.1');
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket handshake timed out')), 2000);
    socket.once('data', data => { clearTimeout(timeout); resolve(data.toString()); });
  });
  socket.write(['GET /market-data/v1/stream?channel=book HTTP/1.1', `Host: 127.0.0.1:${address.port}`,
    'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', '', ''].join('\r\n'));
  const handshake = await response;
  assert.match(handshake, /^HTTP\/1\.1 101 Switching Protocols/);
  assert.ok(handshake.toLowerCase().includes('sec-websocket-accept: s3pplmbitxaq9kygzzhzrbk+xoo='));
  assert.deepEqual(f.upgrades, ['/v1/stream?channel=book']);
  socket.destroy();
  await Promise.race([once(socket, 'close'), new Promise(resolve => setTimeout(resolve, 1000))]);
});

test('private HTTPS origin is checked before REST and WebSocket loopback forwarding', async t => {
  const f = await fixture(); t.after(async () => { f.upgradedSockets.forEach(socket => socket.destroy()); await close(f.server); await close(f.live); await close(f.wall); rmSync(f.root, { recursive: true, force: true }); });
  const targetOrigin = `http://127.0.0.1:${f.live.address().port}`;
  const api = origin => new Promise((resolve, reject) => {
    const request = httpRequest(`${f.base}/market-data/v1/health`, { headers: { host: 'terminal.tail.test:8443', origin } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.end();
  });
  assert.equal(await api('https://terminal.tail.test:8443'), 429);
  assert.equal(f.origins.at(-1), targetOrigin);
  const before = f.liveRequests;
  for (const origin of ['https://evil.example', 'null', 'https://terminal.tail.test:8444']) {
    assert.equal(await api(origin), 403);
  }
  assert.equal(f.liveRequests, before);
  const handshake = async origin => {
    const socket = net.connect(f.server.address().port, '127.0.0.1');
    t.after(() => socket.destroy()); await once(socket, 'connect');
    const reply = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('handshake timeout')), 2000); socket.once('data', value => { clearTimeout(timeout); resolve(value.toString()); }); });
    socket.write(['GET /market-data/v1/stream HTTP/1.1', 'Host: terminal.tail.test:8443', `Origin: ${origin}`, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', '', ''].join('\r\n'));
    const value = await reply; socket.destroy(); return value;
  };
  assert.match(await handshake('https://evil.example'), /^HTTP\/1.1 403/);
  assert.equal(f.upgrades.length, 0);
  assert.match(await handshake('https://terminal.tail.test:8443'), /^HTTP\/1.1 101/);
  assert.equal(f.origins.at(-1), targetOrigin);
});

test('server and Pi route presets stay loopback-only and retain separate live/history targets', () => {
  const server = stagingUpstreams('server', {}), pi = stagingUpstreams('pi', {});
  assert.equal(new URL(server.current).port, '18780');
  assert.equal(new URL(server.wallHistory).port, '18892');
  assert.equal(new URL(pi.current).port, '18781');
  assert.equal(new URL(pi.history).port, '18780');
  assert.equal(matchStagingRoute('/market-data/v1/stream', routes).upstream, 'current');
  assert.throws(() => stagingUpstreams('server', { IQ_UPSTREAM_CURRENT: 'http://example.com' }), /loopback/);
});

test('production manifest routes current, wall, history, liquidations, and watch requests to their intended lanes', () => {
  const route = path => matchStagingRoute(path, stagingProxyRoutes);
  assert.equal(route('/market-data/v1/stream').upstream, 'current');
  assert.equal(route('/market-data/v1/level-watches/stream').upstream, 'watch');
  assert.equal(route('/market-data/v1/liquidations/stream').upstream, 'liquidationStream');
  assert.equal(route('/market-data/v1/liquidations').upstream, 'liquidations');
  assert.equal(route('/market-data/v1/footprints').upstream, 'history');
  assert.equal(route('/market-data/v1/native-candles').upstream, 'nativeHistory');
  assert.equal(route('/market-data/v2/history/walls/reader').upstream, 'wallControl');
  assert.equal(route('/market-data/v2/history/walls/preparation').upstream, 'wallControl');
  assert.equal(route('/market-data/v2/history/walls/part').upstream, 'wallHistory');
  assert.equal(route('/market-data/v1/raw-open-interest').upstream, 'history');
});

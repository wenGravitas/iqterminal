#!/usr/bin/env node
import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROUTES = fileURLToPath(new URL('./staging-proxy-routes.json', import.meta.url));
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.ttf', 'font/ttf'], ['.wasm', 'application/wasm'], ['.txt', 'text/plain; charset=utf-8'],
]);
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const MAX_PROXY_BODY_BYTES = 16 * 1024 * 1024;

function assertLoopbackOrigin(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be an unauthenticated loopback HTTP origin`);
  }
  return url.origin;
}

export function stagingUpstreams(preset = 'server', env = process.env) {
  if (preset !== 'server' && preset !== 'pi') throw new Error('IQ_TARGET_PRESET must be server or pi');
  const defaults = preset === 'server'
    ? { liquidationMap:'18894', current: '18780', history: '18780', wallHistory: '18892', wallControl: '18892', nativeHistory: '18780', liquidations: '18780', liquidationStream: '18780', watch: '18780' }
    : { liquidationMap:'18894', current: '18781', history: '18780', wallHistory: '18882', wallControl: '18883', nativeHistory: '18780', liquidations: '18780', liquidationStream: '18781', watch: '18781' };
  const result = {};
  for (const key of Object.keys(defaults)) {
    const explicit = env[`IQ_UPSTREAM_${key.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`];
    const port = env[`IQ_${key.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_PORT`] ?? defaults[key];
    const value = explicit ?? `http://127.0.0.1:${port}`;
    result[key] = assertLoopbackOrigin(value, `IQ_UPSTREAM_${key.toUpperCase()}`);
  }
  return result;
}

export function matchStagingRoute(pathname, routes) {
  return [...routes].sort((a, b) => b.path.length - a.path.length)
    .find(route => pathname === route.path || pathname.startsWith(`${route.path.replace(/\/$/, '')}/`));
}

function safeHeaders(headers) {
  const blocked = new Set(HOP_HEADERS);
  for (const item of String(headers.connection ?? '').split(',')) if (item.trim()) blocked.add(item.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => !blocked.has(name.toLowerCase()) && value !== undefined));
}

function sameOriginRequest(request) {
  if (request.headers.origin === undefined) return true;
  try {
    const origin = new URL(request.headers.origin);
    return ['http:', 'https:'].includes(origin.protocol) && origin.origin === `${origin.protocol}//${request.headers.host}`;
  } catch { return false; }
}

function upstreamHeaders(request, target) {
  const headers = { ...safeHeaders(request.headers), host: target.host };
  // The private proxy is the browser origin boundary. Collectors retain their
  // loopback-only origin policy after the incoming origin has been checked.
  if (request.headers.origin !== undefined) headers.origin = target.origin;
  return headers;
}

function acceptsEncoding(header = '', name) {
  return header.split(',').some(part => {
    const [encoding, ...params] = part.trim().split(';');
    if (encoding.trim() !== name) return false;
    const q = params.map(value => value.trim()).find(value => value.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}

function immutableAsset(pathname) {
  return pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(pathname);
}

function fileForPath(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return undefined; }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
  const candidate = resolve(root, `.${decoded}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) return undefined;
  return candidate;
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(body);
}

function logProxy(fields) {
  process.stdout.write(`${JSON.stringify({ type: 'market-data-proxy', ...fields })}\n`);
}

export function createStagingStaticServer({ staticRoot, releaseFile, routes, upstreams, bindHost = '127.0.0.1', port = 4180,
  maxProxyBodyBytes = MAX_PROXY_BODY_BYTES } = {}) {
  if (!staticRoot || !releaseFile || !Array.isArray(routes) || !upstreams) throw new Error('Static root, release metadata, routes, and upstream map are required');
  const root = resolve(staticRoot), indexPath = resolve(root, 'index.html');
  const release = JSON.parse(readFileSync(releaseFile, 'utf8'));
  const agents = {
    current: new http.Agent({ keepAlive: true, maxSockets: 4, maxFreeSockets: 4, timeout: 15_000 }),
    history: new http.Agent({ keepAlive: true, maxSockets: 2, maxFreeSockets: 2, timeout: 60_000 }),
    native: new http.Agent({ keepAlive: true, maxSockets: 2, maxFreeSockets: 2, timeout: 60_000 }),
  };
  const checkedRoutes = routes.map(route => {
    if (!route.path.startsWith('/market-data') || !Object.hasOwn(upstreams, route.upstream)
        || !['current', 'history', 'native', 'none'].includes(route.pool) || !Number.isInteger(route.timeoutMs)) {
      throw new Error(`Invalid staging proxy route: ${JSON.stringify(route)}`);
    }
    return route;
  });

  function handleApi(request, response, route, url) {
    if (!sameOriginRequest(request)) return sendJson(response, 403, { error: 'Same-origin request required' });
    if (!route) return sendJson(response, 404, { error: 'Unknown market-data route' });
    const declaredLength = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxProxyBodyBytes) {
      request.resume(); return sendJson(response, 413, { error: 'Market-data request body exceeds the configured limit' });
    }
    const started = performance.now(), target = new URL(upstreams[route.upstream]);
    const upstreamPath = url.pathname.replace(/^\/market-data/, '') || '/';
    const proxyPath = new URL(`${upstreamPath}${url.search}`, target);
    const incoming = upstreamHeaders(request, target);
    const origin = request.headers.origin;
    incoming['x-forwarded-proto'] = request.headers['x-forwarded-proto'] ?? (origin?.startsWith('https://') ? 'https' : 'http');
    const agent = route.pool === 'none' ? false : agents[route.pool];
    const upstreamRequest = http.request(proxyPath, { method: request.method, headers: incoming, agent }, upstreamResponse => {
      const responseHeaders = safeHeaders(upstreamResponse.headers);
      const existingServerTiming = responseHeaders['server-timing'];
      const serverTiming = Array.isArray(existingServerTiming) ? existingServerTiming.join(', ') : existingServerTiming;
      responseHeaders['server-timing'] = [serverTiming, `upstream;dur=${Math.max(0, performance.now() - started).toFixed(1)}`]
        .filter(Boolean).join(', ');
      if (!responseHeaders['cache-control']) responseHeaders['cache-control'] = 'no-store';
      response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
      let responseBytes = 0;
      upstreamResponse.on('data', chunk => { responseBytes += chunk.length; });
      upstreamResponse.on('end', () => logProxy({ route: route.path, upstream: route.upstream, method: request.method,
        status: upstreamResponse.statusCode ?? 502, elapsedMs: Math.round(performance.now() - started), responseBytes, complete: true }));
      upstreamResponse.on('aborted', () => logProxy({ route: route.path, upstream: route.upstream, method: request.method,
        status: upstreamResponse.statusCode ?? 502, elapsedMs: Math.round(performance.now() - started), responseBytes, complete: false }));
      upstreamResponse.pipe(response);
    });
    upstreamRequest.setTimeout(route.timeoutMs, () => upstreamRequest.destroy(new Error('Upstream inactivity timeout')));
    let requestBytes = 0, bodyTooLarge = false;
    upstreamRequest.on('error', error => {
      if (bodyTooLarge) {
        logProxy({ route: route.path, upstream: route.upstream, method: request.method,
          status: 413, elapsedMs: Math.round(performance.now() - started), requestBytes });
        return;
      }
      if (response.headersSent) { if (!response.writableEnded) response.destroy(error); }
      else sendJson(response, /timeout/i.test(error.message) ? 504 : 502, { error: 'Market-data upstream unavailable', retryable: true });
      logProxy({ route: route.path, upstream: route.upstream, method: request.method,
        status: /timeout/i.test(error.message) ? 504 : 502, elapsedMs: Math.round(performance.now() - started), requestBytes, error: error.message });
    });
    request.on('data', chunk => {
      if (bodyTooLarge) return;
      requestBytes += chunk.length;
      if (requestBytes > maxProxyBodyBytes) {
        bodyTooLarge = true;
        request.unpipe(upstreamRequest);
        upstreamRequest.destroy();
        if (!response.headersSent) sendJson(response, 413, { error: 'Market-data request body exceeds the configured limit' });
        request.resume();
      }
    });
    response.on('close', () => { if (!response.writableEnded) upstreamRequest.destroy(); });
    request.pipe(upstreamRequest);
  }

  function staticResponse(request, response, url) {
    let candidate = fileForPath(root, url.pathname);
    if (!candidate) return sendJson(response, 400, { error: 'Invalid path' });
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      if (url.pathname.startsWith('/assets/') || extname(url.pathname)) return sendJson(response, 404, { error: 'Asset not found' });
      candidate = indexPath;
    }
    let stat;
    try { stat = statSync(candidate); } catch { return sendJson(response, 404, { error: 'Not found' }); }
    if (!stat.isFile()) return sendJson(response, 404, { error: 'Not found' });
    const originalPath = candidate === indexPath ? '/index.html' : url.pathname;
    const mime = MIME.get(extname(candidate).toLowerCase()) ?? 'application/octet-stream';
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const immutable = immutableAsset(originalPath), headers = {
      'Content-Type': mime, 'Content-Length': stat.size,
      'Cache-Control': originalPath === '/index.html' ? 'no-cache, must-revalidate' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
      ETag: etag, 'Last-Modified': stat.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
    if (existsSync(`${candidate}.br`) || existsSync(`${candidate}.gz`)) headers.Vary = 'Accept-Encoding';
    if (request.headers['if-none-match'] === etag || request.headers['if-none-match'] === '*') {
      delete headers['Content-Length']; response.writeHead(304, headers); return response.end();
    }
    let selected = candidate;
    const accept = request.headers['accept-encoding'] ?? '';
    if (acceptsEncoding(accept, 'br') && existsSync(`${candidate}.br`)) {
      selected = `${candidate}.br`; headers['Content-Encoding'] = 'br'; headers['Content-Length'] = statSync(selected).size;
    } else if (acceptsEncoding(accept, 'gzip') && existsSync(`${candidate}.gz`)) {
      selected = `${candidate}.gz`; headers['Content-Encoding'] = 'gzip'; headers['Content-Length'] = statSync(selected).size;
    }
    if (request.method === 'HEAD') { response.writeHead(200, headers); return response.end(); }
    response.writeHead(200, headers);
    createReadStream(selected).pipe(response);
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    const url = new URL(request.url ?? '/', 'http://iqterminal.local');
    if (['/__staging/health', '/__staging/release.json'].includes(url.pathname) && ['GET', 'HEAD'].includes(request.method ?? '')) {
      const body = Buffer.from(JSON.stringify({ ok: true, service: 'iqterminal-staging-web', release }));
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return response.end(request.method === 'HEAD' ? undefined : body);
    }
    if (url.pathname.startsWith('/__staging/')) return sendJson(response, 404, { error: 'Not found' });
    if (url.pathname === '/market-data' || url.pathname.startsWith('/market-data/')) {
      if (url.pathname.length > 8192) return sendJson(response, 414, { error: 'URI too long' });
      return handleApi(request, response, matchStagingRoute(url.pathname, checkedRoutes), url);
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) return sendJson(response, 405, { error: 'Method not allowed' });
    return staticResponse(request, response, url);
  });

  server.on('upgrade', (request, socket, head) => {
    if (!sameOriginRequest(request)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const url = new URL(request.url ?? '/', 'http://iqterminal.local');
    const route = matchStagingRoute(url.pathname, checkedRoutes);
    if (!route?.websocket) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    const target = new URL(upstreams[route.upstream]);
    const path = url.pathname.replace(/^\/market-data/, '') || '/';
    const proxyUrl = new URL(`${path}${url.search}`, target), started = performance.now();
    const headers = { ...upstreamHeaders(request, target), connection: 'Upgrade', upgrade: 'websocket' };
    const upstreamRequest = http.request(proxyUrl, { method: request.method, headers, agent: false });
    let settled = false;
    const endWithStatus = (status, phrase) => {
      if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\n\r\n`);
    };
    upstreamRequest.setTimeout(route.timeoutMs, () => upstreamRequest.destroy(new Error('WebSocket upstream inactivity timeout')));
    upstreamRequest.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      settled = true;
      const lines = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage ?? http.STATUS_CODES[response.statusCode ?? 101] ?? 'Switching Protocols'}`];
      const websocketHeaders = { ...safeHeaders(response.headers), connection: 'Upgrade', upgrade: 'websocket' };
      for (const [name, value] of Object.entries(websocketHeaders)) {
        for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket); upstreamSocket.pipe(socket);
      const close = () => { socket.destroy(); upstreamSocket.destroy(); };
      socket.once('error', close); upstreamSocket.once('error', close);
      socket.once('close', () => upstreamSocket.destroy()); upstreamSocket.once('close', () => socket.destroy());
      logProxy({ route: route.path, upstream: route.upstream, method: 'UPGRADE', status: response.statusCode ?? 101,
        elapsedMs: Math.round(performance.now() - started), complete: true });
    });
    upstreamRequest.on('response', response => {
      settled = true;
      const lines = [`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? 'Upstream error'}`];
      for (const [name, value] of Object.entries(safeHeaders(response.headers))) for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`); response.pipe(socket);
    });
    upstreamRequest.on('error', error => {
      if (!settled) endWithStatus(/timeout/i.test(error.message) ? 504 : 502, /timeout/i.test(error.message) ? 'Gateway Timeout' : 'Bad Gateway');
      logProxy({ route: route.path, upstream: route.upstream, method: 'UPGRADE', status: /timeout/i.test(error.message) ? 504 : 502,
        elapsedMs: Math.round(performance.now() - started), error: error.message });
    });
    upstreamRequest.end();
  });

  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 65_000;
  server.requestTimeout = 300_000;
  server.timeout = 0;
  server.on('close', () => Object.values(agents).forEach(agent => agent.destroy()));
  server.listen(port, bindHost);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const routesFile = process.env.IQ_ROUTE_MANIFEST ?? DEFAULT_ROUTES;
  const routes = JSON.parse(readFileSync(routesFile, 'utf8'));
  const server = createStagingStaticServer({
    staticRoot: process.env.IQ_STATIC_ROOT,
    releaseFile: process.env.IQ_RELEASE_FILE,
    routes,
    upstreams: stagingUpstreams(process.env.IQ_TARGET_PRESET ?? 'server'),
    bindHost: process.env.IQ_BIND_HOST ?? '127.0.0.1',
    port: Number(process.env.IQ_PORT ?? '4180'),
  });
  server.on('listening', () => process.stdout.write(`${JSON.stringify({ type: 'staging-static-server-ready', address: server.address(), release: JSON.parse(readFileSync(process.env.IQ_RELEASE_FILE, 'utf8')) })}\n`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}

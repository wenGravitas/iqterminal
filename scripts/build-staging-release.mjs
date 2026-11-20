#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutputRoot = join(homedir(), '.local', 'share', 'iqterminal-staging', 'releases');

function git(args, cwd = root) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: options.env ?? process.env });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? result.signal}`);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }

const args = process.argv.slice(2);
if (args.includes('--help')) {
  process.stdout.write('Usage: pnpm build:staging:production -- --backend-sha <40-hex-sha> [--diagnostics]\n');
  process.exit(0);
}
const backendShaIndex = args.indexOf('--backend-sha');
const backendSha = backendShaIndex >= 0 ? args[backendShaIndex + 1] : process.env.IQ_BACKEND_SHA;
if (!/^[a-f0-9]{40}$/.test(backendSha ?? '')) throw new Error('Provide the integrated backend main SHA with --backend-sha or IQ_BACKEND_SHA');
const diagnostics = args.includes('--diagnostics');
const branch = git(['branch', '--show-current']);
if (!['main', 'dev'].includes(branch)) throw new Error(`Production staging builds must use the shared dev/main integration revision (current branch: ${branch || 'detached'})`);
const frontendSha = git(['rev-parse', 'HEAD']);
if (frontendSha !== git(['rev-parse', 'origin/main']) || frontendSha !== git(['rev-parse', 'origin/dev'])) throw new Error('Frontend dev and main must both be pushed at the clean release commit');
if (git(['status', '--porcelain=v1', '--untracked-files=all'])) throw new Error('Release build requires a clean frontend worktree');
const backendRepo = resolve(root, '../iqterminal-server');
if (!existsSync(join(backendRepo, '.git'))) throw new Error(`Backend checkout not found: ${backendRepo}`);
git(['cat-file', '-e', `${backendSha}^{commit}`], backendRepo);
if (git(['rev-parse', 'main'], backendRepo) !== backendSha || git(['rev-parse', 'github/main'], backendRepo) !== backendSha) throw new Error('Backend SHA must be the current local and GitHub backend main commit');

const config = { dataMode: 'staging', historyTiles: true, diagnostics, minify: true };
const releaseId = `${frontendSha}-${backendSha}${diagnostics ? '-diag' : ''}`;
const outputRoot = resolve(process.env.IQ_RELEASE_OUTPUT ?? defaultOutputRoot);
const releaseDir = join(outputRoot, releaseId);
if (existsSync(releaseDir)) throw new Error(`Immutable release already exists: ${releaseDir}`);
mkdirSync(outputRoot, { recursive: true });
const releaseStage = mkdtempSync(join(outputRoot, `.${releaseId}.tmp-`));
const tmp = mkdtempSync(join(tmpdir(), 'iqterminal-staging-build-'));
const outputDist = join(tmp, 'dist');
const env = { ...process.env,
  VITE_DATA_MODE: 'staging', VITE_HISTORY_TILES: '1', VITE_DIAGNOSTICS: diagnostics ? '1' : '0',
  VITE_WALL_NEWEST_FIRST: '1', VITE_BUILD_COMMIT: frontendSha,
};

try {
  run('pnpm', ['exec', 'tsc', '--noEmit']);
  run('pnpm', ['exec', 'vite', 'build', '--mode', 'staging', '--outDir', outputDist], { env });
  const compressible = /\.(?:html|js|mjs|css|json|svg|txt|xml|wasm)$/i;
  let compressedFiles = 0;
  const fileRecords = [];
  for (const file of walk(outputDist)) {
    const content = readFileSync(file), relative = file.slice(outputDist.length + 1);
    fileRecords.push({ path: relative, bytes: content.length, sha256: sha256(content) });
    if (!compressible.test(file)) continue;
    const br = brotliCompressSync(content, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } });
    const gz = gzipSync(content, { level: 6 });
    writeFileSync(`${file}.br`, br); writeFileSync(`${file}.gz`, gz); compressedFiles++;
  }
  const distDir = join(releaseStage, 'dist');
  cpSync(outputDist, distDir, { recursive: true, errorOnExist: true });
  const routes = JSON.parse(readFileSync(join(root, 'scripts/staging-proxy-routes.json'), 'utf8'));
  const manifest = {
    schemaVersion: 1, releaseId, frontend: { repository: 'wenGravitas/iqterminal', commit: frontendSha },
    backend: { repository: 'wenGravitas/iqterminal-server', commit: backendSha },
    builtAt: new Date().toISOString(), build: { viteMode: 'staging', viteProduction: true, node: process.version, platform: process.platform, arch: process.arch },
    configuration: { ...config, apiRouteCount: routes.length, apiRoutesSha256: sha256(Buffer.from(JSON.stringify(routes))) },
    assets: { files: fileRecords.length, precompressedFiles: compressedFiles, sha256: fileRecords },
  };
  writeFileSync(join(releaseStage, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(join(releaseStage, 'runtime'), { recursive: true });
  cpSync(join(root, 'scripts/staging-static-server.mjs'), join(releaseStage, 'runtime/staging-static-server.mjs'));
  cpSync(join(root, 'scripts/staging-proxy-routes.json'), join(releaseStage, 'runtime/staging-proxy-routes.json'));
  writeFileSync(join(releaseStage, 'Dockerfile'), [
    'ARG BASE_IMAGE', 'FROM ${BASE_IMAGE}',
    'COPY --chown=1000:1000 runtime/staging-static-server.mjs /opt/iqterminal-web/staging-static-server.mjs',
    'COPY --chown=1000:1000 runtime/staging-proxy-routes.json /opt/iqterminal-web/staging-proxy-routes.json',
    'USER 1000:1000', 'ENTRYPOINT ["node", "/opt/iqterminal-web/staging-static-server.mjs"]', '',
  ].join('\n'));
  writeFileSync(join(releaseStage, '.dockerignore'), '**\n!runtime\n!runtime/**\n!Dockerfile\n!.dockerignore\n');
  writeFileSync(join(releaseStage, 'compose.yaml'), [
    'services:', '  web:', '    image: ${IQ_IMAGE}', '    container_name: ${IQ_CONTAINER_NAME}',
    '    build:', '      context: .', '      dockerfile: Dockerfile', '      args:', '        BASE_IMAGE: ${IQ_BASE_IMAGE}',
    '    network_mode: host', '    restart: unless-stopped', '    init: true', '    user: "1000:1000"',
    '    read_only: true', '    cap_drop: [ALL]', '    security_opt: [no-new-privileges:true]',
    '    mem_limit: 192m', '    cpus: 1.0', '    pids_limit: 48',
    '    tmpfs:', '      - /tmp:rw,nosuid,nodev,noexec,size=16m',
    '    volumes:', '      - ${IQ_RELEASE_DIR}:/srv/release:ro',
    '    environment:', '      IQ_STATIC_ROOT: /srv/release/dist', '      IQ_RELEASE_FILE: /srv/release/release.json',
    '      IQ_ROUTE_MANIFEST: /opt/iqterminal-web/staging-proxy-routes.json',
    '      IQ_TARGET_PRESET: server', '      IQ_BIND_HOST: 127.0.0.1', '      IQ_PORT: ${IQ_PORT}',
    '    healthcheck:', '      test: [CMD, node, -e, "fetch(\'http://127.0.0.1:\'+process.env.IQ_PORT+\'/__staging/health\').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]',
    '      interval: 15s', '      timeout: 4s', '      retries: 3', '      start_period: 5s',
    '    logging:', '      driver: json-file', '      options:', '        max-size: 10m', '        max-file: "2"',
    '    labels:', '      org.opencontainers.image.title: IQTerminal production staging frontend',
    '      org.opencontainers.image.revision: ' + frontendSha,
    '      io.iqterminal.release: ' + releaseId, '',
  ].join('\n'));
  const bundleFiles = walk(releaseStage).sort();
  const bundleChecksums = bundleFiles.map(file => `${sha256(readFileSync(file))}  ${file.slice(releaseStage.length + 1)}`).join('\n') + '\n';
  writeFileSync(join(releaseStage, 'bundle.sha256'), bundleChecksums);
  renameSync(releaseStage, releaseDir);
  process.stdout.write(`${JSON.stringify({ releaseDir, releaseId, frontendSha, backendSha, diagnostics, build: manifest.build, assets: manifest.assets.files, precompressed: compressedFiles }, null, 2)}\n`);
} catch (error) {
  rmSync(releaseStage, { recursive: true, force: true });
  throw error;
} finally {
  rmSync(releaseStage, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
}

// Explicit synthetic CPU benchmark; never connected to production feeds or UI.
// Run: node --expose-gc scripts/bench-footprint-accumulator.mjs
import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { FootprintAggregator } from 'openalgo-charts/profile';

const directory = await mkdtemp(join(tmpdir(), 'iqterminal-footprint-bench-'));
try {
  await build({ configFile: false, logLevel: 'silent', build: { lib: { entry: 'src/feed/footprint.ts', formats: ['es'], fileName: () => 'accumulator.mjs' }, outDir: directory, emptyOutDir: false, minify: false } });
  const { FootprintAccumulator } = await import(pathToFileURL(join(directory, 'accumulator.mjs')).href);
  const base = 1_800_000_000_000;
  const records = Array.from({ length: 20_000 }, (_, id) => ({ venue: 'binance', market: 'perpetual', nativeSymbol: 'BTCUSDT', granularity: 'aggregate-trade', executionId: `synthetic:${id}`, id, firstTradeId: id * 3, lastTradeId: id * 3 + 2, timeMs: base + id, eventTimeMs: base + id, price: (830000 + (id * 17 % 1200)) / 10, quantity: (1 + id % 20) / 1000, side: id % 3 === 0 ? 'sell' : 'buy' }));
  const quantile = (values, fraction) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
  const results = [];
  for (const count of [1, 2, 8]) {
    for (const rate of [1000, 10000]) {
      const configurations = [{ interval: '1m', ticks: 10, ms: 60000 }, { interval: '1m', ticks: 20, ms: 60000 }, { interval: '1m', ticks: 50, ms: 60000 }, { interval: '1m', ticks: 1, ms: 60000 }, { interval: '1m', ticks: 2, ms: 60000 }, { interval: '1m', ticks: 5, ms: 60000 }, { interval: '5m', ticks: 10, ms: 300000 }, { interval: '15m', ticks: 10, ms: 900000 }].slice(0, count);
      const groups = configurations.map(config => new FootprintAccumulator(config.interval, 0.1, config.ticks));
      // Populate bounded retained history before measuring bursts/eviction.
      for (const [groupIndex, group] of groups.entries()) {
        for (let bar = 0; bar < 300; bar++) for (let row = 0; row < 120; row++) group.ingest({ ...records[row], timeMs: base - (300 - bar) * configurations[groupIndex].ms + row, price: (830000 + row * 10) / 10 });
        group.drainDirty();
      }
      global.gc?.();
      const heapBefore = process.memoryUsage().heapUsed;
      const timings = [];
      let outputBars = 0;
      const batchSize = rate / 10;
      const started = performance.now();
      for (let offset = 0; offset < records.length; offset += batchSize) {
        const begin = performance.now();
        for (let index = offset; index < Math.min(offset + batchSize, records.length); index++) {
          const trade = { ...records[index], timeMs: base + Math.floor(index * 1000 / rate) };
          for (const group of groups) group.ingest(trade);
        }
        for (const group of groups) outputBars += group.drainDirty().length;
        timings.push(performance.now() - begin);
      }
      const elapsedMs = performance.now() - started;
      global.gc?.();
      results.push({ configurations: count, syntheticRecordsPerSecond: rate, records: records.length, batchCadenceMs: 100, elapsedCpuMs: elapsedMs, batchP50Ms: quantile(timings, .5), batchP95Ms: quantile(timings, .95), batchMaxMs: Math.max(...timings), outputBarSnapshots: outputBars, retained: groups.map(group => ({ bars: group.barCount, cells: group.cellCount, capacityDrops: group.drops })), postGcHeapChangeBytes: process.memoryUsage().heapUsed - heapBefore });
    }
  }
  const upstream = new FootprintAggregator({ mode: 'interval', seconds: 60 }, 0.1, 10);
  const begin = performance.now();
  for (const trade of records) upstream.onTick({ time: trade.timeMs / 1000, price: trade.price, qty: trade.quantity, side: trade.side === 'sell' ? 'bid' : 'ask' });
  const upstreamMs = performance.now() - begin;
  const compatible = new FootprintAccumulator('1m', 0.1, 10);
  const compatibleStarted = performance.now();
  for (const trade of records) compatible.ingest(trade);
  const batch = compatible.drainDirty()[0];
  const compatibleMs = performance.now() - compatibleStarted;
  const original = upstream.current();
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
  for (const field of ['time', 'open', 'high', 'low', 'close', 'delta', 'minDelta', 'maxDelta']) near(batch[field], original[field]);
  assert.equal(batch.cells.length, original.cells.length);
  for (let index = 0; index < batch.cells.length; index++) for (const field of ['price', 'bidVol', 'askVol']) near(batch.cells[index][field], original.cells[index][field]);
  const report = { fixture: 'Explicit synthetic aggregate observations, 1200 tick range, 20k burst records; retained history populated first', scope: 'CPU aggregation and batch snapshot cost only; excludes worker messaging, browser rendering and total process memory. No raw Binance replay or production data.', machine: { platform: process.platform, arch: process.arch, node: process.version }, results, upstream: { library: 'openalgo-charts@2.6.0', records: records.length, elapsedCpuMs: upstreamMs, snapshotEveryTick: true }, equivalentSingleAccumulator: { elapsedCpuMs: compatibleMs, batchSnapshotOnce: true, upstreamValueParity: 'OHLC, delta extrema and every bid/ask row verified within 1e-8' } };
  await writeFile(process.env.FOOTPRINT_BENCH_OUTPUT || 'artifacts/performance-footprint-accumulator.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }

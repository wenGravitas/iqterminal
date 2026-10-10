import { afterEach, expect, it, vi } from 'vitest';
import { history, parseLive, socketURL, subscription } from '../src/feed/adapters';
import { canonicalSeries, connectionKey, keyOf, seriesForInstrument, supportsDepth } from '../src/feed/protocol';

afterEach(() => vi.unstubAllGlobals());

const spot = { venue: 'binance', market: 'spot', interval: '1m' } as const;
const perpetual = { venue: 'binance', market: 'perpetual', interval: '1m' } as const;

it('uses public Spot klines and normalizes BTC base volume from the native response', async () => {
  const row = [1791558000000, '83000', '83100', '82900', '83050', '1.25', 1791558059999, '103812.5', 17, '0.75', '62250', '0'];
  const urls: string[] = [];
  const request: typeof fetch = async input => {
    urls.push(String(input));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [row],
    } as unknown as Response;
  };
  vi.stubGlobal('fetch', request);

  const bars = await history(spot, new AbortController().signal);
  expect(urls[0]).toBe('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000');
  expect(bars).toHaveLength(1);
  expect(bars[0]).toMatchObject({ t: row[0], o: 83000, h: 83100, l: 82900, c: 83050, v: 1.25 });
});

it('keeps Spot stream, perpetual stream, and persisted series identity separate', () => {
  expect(socketURL(spot)).toBe('wss://data-stream.binance.vision/stream');
  expect(socketURL(perpetual)).toBe('wss://fstream.binance.com/market/stream');
  expect(subscription(spot, true, 7)).toEqual({ method: 'SUBSCRIBE', params: ['btcusdt@kline_1m'], id: '7' });
  expect(connectionKey(spot)).not.toBe(connectionKey(perpetual));
  expect(keyOf(spot)).not.toBe(keyOf(perpetual));
  expect(keyOf({ venue: 'binance', interval: '1m' })).toBe(keyOf(perpetual));
  expect(seriesForInstrument('binance:spot', '1m')).toEqual(spot);
});

it('parses native BTCUSDT Spot kline payloads and keeps depth capability USD-M only', () => {
  const raw = { e: 'kline', E: 100, s: 'BTCUSDT', k: { s: 'BTCUSDT', i: '1m', t: 1791558000000, T: 1791558059999, o: '83000', h: '83100', l: '82900', c: '83050', v: '1.25', x: false } };
  expect(parseLive(raw, spot)).toMatchObject([{ v: 1.25, c: 83050, closed: false }]);
  expect(parseLive(raw, { ...spot, interval: '5m' })).toEqual([]);
  expect(supportsDepth(spot)).toBe(false);
  expect(supportsDepth(perpetual)).toBe(true);
});

it('normalizes old persisted series to perpetual and rejects invalid market combinations', () => {
  expect(canonicalSeries({ venue: 'binance', interval: '1m' })).toEqual(perpetual);
  expect(canonicalSeries({ venue: 'binance', market: 'spot', interval: '1m' })).toEqual(spot);
  expect(canonicalSeries({ venue: 'hyperliquid', market: 'spot', interval: '1m' })).toBeNull();
});

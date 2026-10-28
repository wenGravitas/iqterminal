import { describe, expect, it } from 'vitest';
import { parseBybitLiquidations, parseBinanceLiquidations } from '../src/liquidations/adapters';
import { LIQUIDATION_MAX_MESSAGE_RECORDS, LIQUIDATION_SOURCES } from '../src/liquidations/model';

const time = 1_792_931_000_000;
const record = (patch: Record<string, unknown> = {}) => ({ T: time, s: 'BTCUSDT', S: 'Buy', v: '0.125', p: '80000.10', ...patch });
const bybit = (data: unknown = [record()]) => ({ topic: 'allLiquidation.BTCUSDT', type: 'snapshot', ts: time + 500, data });
const binance = (patch: Record<string, unknown> = {}) => ({ e: 'forceOrder', E: time + 5, o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '1', p: '81000', ap: '80000.10', X: 'FILLED', l: '0.125', z: '0.125', T: time, ...patch } });

describe('actual liquidation source contracts', () => {
  it('uses the routed Binance market stream and Bybit allLiquidation topic', () => {
    expect(LIQUIDATION_SOURCES.binance.url).toBe('wss://fstream.binance.com/market/ws/btcusdt@forceOrder');
    expect(LIQUIDATION_SOURCES.bybit.topic).toBe('allLiquidation.BTCUSDT');
  });
  it('parses every Bybit record, maps position side and keeps bankruptcy valuation explicit', () => {
    const result = parseBybitLiquidations(bybit([record(), record({ S: 'Sell', T: time - 100 })]), time + 600);
    expect(result.events).toHaveLength(2); expect(result.rejected).toEqual([]);
    expect(result.events[0]).toMatchObject({
      venue: 'bybit', instrument: 'bybit:perpetual:BTCUSDT', liquidatedSide: 'LONG', forcedDirection: 'SELL',
      timeMs: time, eventTimeMs: time + 500, receivedAtMs: time + 600,
      reportedPrice: 80000.1, priceType: 'bankruptcy', baseQuantity: .125,
      quoteNotionalText: '10000.0125', notionalBasis: 'bankruptcy-price-times-size',
      reportingCoverage: 'all-reported-liquidations', provenance: { reportedSide: 'Buy', sideMeaning: 'liquidated-position' },
    });
    expect(result.events[1]).toMatchObject({ liquidatedSide: 'SHORT', forcedDirection: 'BUY', timeMs: time - 100 });
  });
  it('keeps valid siblings when records are malformed', () => {
    const result = parseBybitLiquidations(bybit([record(), null, record({ S: 'unknown' }), record({ v: '-1' }), record({ s: 'ETHUSDT' }), record({ T: 'bad' }), record({ p: 'NaN' }), record({ S: 'Sell' })]), time + 600);
    expect(result.events).toHaveLength(2);
    expect(result.rejected).toEqual([
      { index: 1, reason: 'envelope' }, { index: 2, reason: 'side' }, { index: 3, reason: 'quantity' },
      { index: 4, reason: 'symbol' }, { index: 5, reason: 'time' }, { index: 6, reason: 'price' },
    ]);
  });
  it('preserves identical occurrences and stable replay keys without inventing an exchange ID', () => {
    const message = bybit([record(), record(), record({ S: 'Sell' })]);
    const first = parseBybitLiquidations(message, time + 600).events;
    const replay = parseBybitLiquidations({ ...message, ts: time + 700 }, time + 800).events;
    expect(new Set(first.map(e => e.id)).size).toBe(3);
    expect(first.map(e => e.id)).toEqual(replay.map(e => e.id));
    expect(first[0]!.nativeEventId).toBeNull();
    expect(first[1]!.provenance).toMatchObject({ occurrence: 1, identityLimitation: 'no-native-event-id' });
    expect(parseBybitLiquidations(bybit([record({ S: 'Sell' }), record(), record()]), time + 900).events.map(e => e.id).sort()).toEqual(first.map(e => e.id).sort());
  });
  it('canonicalizes equivalent decimal spellings while preserving exact price-times-size', () => {
    const a = parseBybitLiquidations(bybit([record({ p: '00080000.100', v: '00.1250' })]), time + 600).events[0]!;
    const b = parseBybitLiquidations(bybit(), time + 700).events[0]!;
    expect(a.id).toBe(b.id); expect(a.quoteNotionalText).toBe('10000.0125');
  });
  it('bounds parsing and ignores heartbeat and unrelated traffic', () => {
    expect(parseBybitLiquidations({ op: 'pong' }, time).ignored).toBe(true);
    expect(parseBybitLiquidations({ ...bybit(), topic: 'allLiquidation.ETHUSDT' }, time).rejected[0]!.reason).toBe('symbol');
    expect(parseBybitLiquidations(bybit(new Array(LIQUIDATION_MAX_MESSAGE_RECORDS + 1).fill(record())), time).rejected[0]!.reason).toBe('capacity');
    for (const p of ['1e5', 'Infinity', '0', '0x10', '1'.repeat(1000), 80000]) {
      expect(parseBybitLiquidations(bybit([record({ p })]), time).rejected[0]!.reason).toBe('price');
    }
    expect(parseBybitLiquidations({ ...bybit(), ts: Infinity }, time).rejected[0]!.reason).toBe('time');
    expect(parseBybitLiquidations(bybit(), NaN).rejected[0]!.reason).toBe('time');
  });
  it('maps Binance forced-order side and uses cumulative fills and average fill price', () => {
    const result = parseBinanceLiquidations(binance(), time + 20);
    expect(result.events[0]).toMatchObject({
      venue: 'binance', liquidatedSide: 'LONG', forcedDirection: 'SELL', reportedPrice: 80000.1,
      priceType: 'average-fill', baseQuantity: .125, quoteNotionalText: '10000.0125',
      quantityBasis: 'reported-cumulative-filled', notionalBasis: 'average-fill-times-cumulative-filled',
      reportingCoverage: 'latest-per-symbol-1000ms', provenance: { originalQuantityText: '1', orderPriceText: '81000', sideMeaning: 'forced-order' },
    });
    expect(parseBinanceLiquidations(binance({ S: 'BUY' }), time + 20).events[0]).toMatchObject({ liquidatedSide: 'SHORT', forcedDirection: 'BUY' });
  });
  it('accepts raw/combined Binance envelopes, replay and out-of-order timestamps', () => {
    const raw = binance(), first = parseBinanceLiquidations(raw, time + 20).events[0]!;
    expect(parseBinanceLiquidations({ stream: 'btcusdt@forceOrder', data: raw }, time + 100).events[0]!.id).toBe(first.id);
    expect(parseBinanceLiquidations({ ...raw, E: time + 200 }, time + 300).events[0]!.id).toBe(first.id);
    expect(parseBinanceLiquidations(binance({ T: time - 500 }), time + 400).events[0]!.timeMs).toBe(time - 500);
  });
  it('does not invent execution notional when average fill is unavailable', () => {
    const event = parseBinanceLiquidations(binance({ ap: '0', z: '0', l: '0', X: 'NEW' }), time + 20).events[0]!;
    expect(event).toMatchObject({ priceType: 'order-limit', reportedPrice: 81000, baseQuantity: 0, quoteNotional: null, quoteNotionalText: null, notionalBasis: 'unavailable' });
    expect(parseBinanceLiquidations(binance({ ap: '0' }), time + 20).events[0]!.quoteNotional).toBeNull();
  });
  it('rejects COIN-M and unrelated symbols without broadening chart market support', () => {
    expect(parseBinanceLiquidations({ ...binance(), st: 2 }, time).rejected[0]!.reason).toBe('contract');
    expect(parseBinanceLiquidations(binance({ st: 2 }), time).rejected[0]!.reason).toBe('contract');
    expect(parseBinanceLiquidations(binance({ s: 'BTCUSD_PERP' }), time).rejected[0]!.reason).toBe('symbol');
    expect(parseBinanceLiquidations({ e: 'aggTrade' }, time).ignored).toBe(true);
  });
  it('rejects impossible fills, missing semantics, and invalid timestamps', () => {
    for (const patch of [{ z: '2' }, { l: '0.5' }, { z: '-1' }, { z: undefined }, { q: '0.125', z: '0.125000000000000001' }, { l: '0.125000000000000001' }]) {
      expect(parseBinanceLiquidations(binance(patch), time).rejected[0]!.reason).toBe('quantity');
    }
    expect(parseBinanceLiquidations(binance({ S: 'Buy' }), time).rejected[0]!.reason).toBe('side');
    expect(parseBinanceLiquidations(binance({ T: time + .1 }), time).rejected[0]!.reason).toBe('time');
    expect(parseBinanceLiquidations(binance({ ap: undefined }), time).rejected[0]!.reason).toBe('price');
  });
});

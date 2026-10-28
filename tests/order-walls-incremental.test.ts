import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER_WALLS_SETTINGS,
  OrderWallDetector,
  orderWallsSettings,
  type OrderWallDepthRecord,
  type OrderWallSegment,
  type OrderWallsSettings,
} from '../src/feed/order-walls';

const at0 = 1_800_100_000_000;
const configured = (patch: Partial<OrderWallsSettings> = {}) => orderWallsSettings({
  ...DEFAULT_ORDER_WALLS_SETTINGS, mode: 'threshold' as const,
  enabled: true,
  method: 'relative',
  relativeFloorUsd: 1_000_000,
  relativePercentile: 90,
  exitRatio: 0.8,
  aggregation: 'auto',
  ...patch,
});

/** Retains the previous full-book bucketing algorithm as an independent oracle. */
class FullScanOrderWallDetector extends OrderWallDetector {
  protected override collectBuckets(levels: Map<number, number>) {
    const sums = new Map<number, number>();
    for (const [price, quantity] of levels) {
      const low = this.bucketPrice(price);
      sums.set(low, (sums.get(low) ?? 0) + price * quantity);
    }
    return [...sums].map(([price, usd]) => ({ price, usd })).sort((a, b) => a.price - b.price);
  }
}

function rounded(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1e7) / 1e7 : value;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, rounded(entry)]));
  return value;
}

function priceAt(index: number) { return Number((60_000 + index / 10).toFixed(1)); }
function seedLevels(side: 'bid' | 'ask', offset = 0): Array<[number, number]> {
  return Array.from({ length: 5_005 }, (_, i) => [
    side === 'bid' ? priceAt(500 - i) - offset : priceAt(510 + i) + offset,
    10 * (1 + (i % 11)),
  ]);
}
function referenceTrim(map: Map<number, number>, side: 'bid' | 'ask') {
  if (map.size <= 5_000) return;
  const sorted = [...map.keys()].sort((a, b) => side === 'bid' ? b - a : a - b);
  for (const price of sorted.slice(5_000)) map.delete(price);
}
function updateReference(map: Map<number, number>, levels: ReadonlyArray<readonly [number, number]>, side: 'bid' | 'ask') {
  for (const [price, quantity] of levels) quantity === 0 ? map.delete(price) : map.set(price, quantity);
  referenceTrim(map, side);
}
function makeSeed(at: number, cursor: number, epoch: number, bids: Array<[number, number]>, asks: Array<[number, number]>): OrderWallDepthRecord {
  return { kind: 'snapshot', at, cursor, epoch, bids, asks,
    bookScope: { maxLevelsPerSide: 5_000, bidComplete: true, askComplete: true } };
}

describe('incremental Order Wall bucket notional cache', () => {
  it('matches a full-scan oracle across replacements, seeds, checkpoints, gaps, trims, zeros and width changes', () => {
    const settings = configured();
    const fast = new OrderWallDetector(settings, 0.1, 10);
    const reference = new FullScanOrderWallDetector(settings, 0.1, 10);
    const bids = new Map<number, number>(), asks = new Map<number, number>();
    let random = 0x73ac5e19;
    let cursor = 0;
    const rand = (limit: number) => {
      random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
      return random % limit;
    };
    const process = (records: OrderWallDepthRecord[]) => {
      const actual = fast.processBatch(records), expected = reference.processBatch(records);
      expect(rounded(actual)).toEqual(rounded(expected));
    };
    const resetReference = (record: OrderWallDepthRecord) => {
      bids.clear(); asks.clear();
      updateReference(bids, record.bids ?? [], 'bid');
      updateReference(asks, record.asks ?? [], 'ask');
    };

    const initialBids = seedLevels('bid'), initialAsks = seedLevels('ask');
    const initial = makeSeed(at0, ++cursor, 1, initialBids, initialAsks);
    process([initial]); resetReference(initial);

    for (let tick = 1; tick <= 220; tick++) {
      if (tick === 30) { fast.setAutoPriceWidth(50); reference.setAutoPriceWidth(50); }
      if (tick === 60) {
        const absolute = configured({ method: 'absolute', thresholdUsd: 275_000_000 });
        fast.updateSettings(absolute); reference.updateSettings(absolute);
      }
      if (tick === 85) {
        const newWidth = configured({ method: 'relative', aggregation: 100 });
        fast.updateSettings(newWidth); reference.updateSettings(newWidth);
      }
      if (tick === 100) {
        const auto = configured({ method: 'relative', aggregation: 'auto' });
        fast.updateSettings(auto); reference.updateSettings(auto);
      }
      if (tick === 125) { fast.setAutoPriceWidth(250); reference.setAutoPriceWidth(250); }
      if (tick === 155) { fast.setAutoPriceWidth(10); reference.setAutoPriceWidth(10); }

      const time = at0 + tick * 100;
      if (tick === 75) {
        const checkpoint = makeSeed(time, ++cursor, 1, [...bids], [...asks]);
        checkpoint.kind = 'checkpoint';
        process([checkpoint]); resetReference(checkpoint);
        continue;
      }
      if (tick === 145) {
        const replacement = makeSeed(time, ++cursor, 2, seedLevels('bid', 1), seedLevels('ask', 1));
        process([replacement]); resetReference(replacement);
        continue;
      }
      if (tick === 175) {
        const gap: OrderWallDepthRecord = { kind: 'gap', at: time, cursor: ++cursor, epoch: 2, reason: 'randomized test gap' };
        process([gap]); bids.clear(); asks.clear();
        continue;
      }
      if (tick === 176) {
        const ignored: OrderWallDepthRecord = { kind: 'delta', at: time, cursor: ++cursor, epoch: 2,
          bids: [[priceAt(500), 0]], asks: [[priceAt(510), 0]] };
        process([ignored]);
        continue;
      }
      if (tick === 177) {
        const recovery = makeSeed(time, ++cursor, 2, seedLevels('bid', 2), seedLevels('ask', 2));
        process([recovery]); resetReference(recovery);
        continue;
      }

      const changes = (): Array<[number, number]> => {
        const updates = new Map<number, number>();
        const count = 1 + rand(8);
        for (let i = 0; i < count; i++) {
          const price = priceAt(450 + rand(120)) + (rand(5) === 0 ? (rand(11) - 5) * 50 : 0);
          const quantity = rand(7) === 0 ? 0 : 10 * (1 + rand(100));
          updates.set(price, quantity);
        }
        return [...updates];
      };
      const bidUpdates = changes(), askUpdates = changes();
      // Force a known removal and a new outer level so both trim directions run.
      if (tick === 1) bidUpdates.push([initialBids[0]![0], 0]);
      if (tick === 2) askUpdates.push([initialAsks[0]![0], 0]);
      if (tick % 19 === 0) {
        bidUpdates.push([priceAt(500) + 500, 900]);
        askUpdates.push([priceAt(510) + 1_000, 900]);
      }
      const delta: OrderWallDepthRecord = { kind: 'delta', at: time, cursor: ++cursor, epoch: tick < 145 ? 1 : 2,
        bids: bidUpdates, asks: askUpdates };
      const records = [delta], updates = [{ bids: bidUpdates, asks: askUpdates }];
      if (tick % 29 === 0) {
        const bidExtra: Array<[number, number]> = [[priceAt(495) + 250, 10 * (1 + rand(100))]];
        const askExtra: Array<[number, number]> = [[priceAt(515) - 250, 10 * (1 + rand(100))]];
        records.push({ kind: 'delta', at: time, cursor: ++cursor, epoch: delta.epoch, bids: bidExtra, asks: askExtra });
        updates.push({ bids: bidExtra, asks: askExtra });
      }
      process(records);
      for (const change of updates) {
        updateReference(bids, change.bids, 'bid'); updateReference(asks, change.asks, 'ask');
      }

      if (tick % 23 === 0) {
        expect(rounded(fast.snapshot())).toEqual(rounded(reference.snapshot()));
        expect(rounded(fast.status(at0, time + 1))).toEqual(rounded(reference.status(at0, time + 1)));
      }
    }
  }, 15_000);
});

import { describe, expect, it } from 'vitest';
import { BinanceDepthBook, type DepthDiff, type DepthSnapshot } from '../src/feed/depth-book';

const snapshot: DepthSnapshot = {
  lastUpdateId: 100,
  bids: [['100', '2'], ['99', '3'], ['90', '1']],
  asks: [['100.1', '4'], ['101', '5'], ['110', '2']],
};
const diff = (U: number, u: number, pu: number, b: DepthDiff['b'] = [], a: DepthDiff['a'] = []): DepthDiff => ({ U, u, pu, b, a });
function synchronizedBook() {
  const book = new BinanceDepthBook();
  book.beginSync();
  book.push(diff(100, 101, 99), 900);
  expect(book.applySnapshot(snapshot, 1000)).toBe(true);
  return book;
}

describe('Binance USD-M depth synchronization', () => {
  it('bridges a buffered first update and requires the previous final update ID thereafter', () => {
    const book = new BinanceDepthBook();
    book.beginSync();
    expect(book.push(diff(98, 101, 97, [['100', '1.5']]), 1000)).toBe('buffered');
    expect(book.applySnapshot(snapshot, 900)).toBe(true);
    expect(book.state).toBe('live');
    expect(book.lastUpdateId).toBe(101);
    expect(book.push(diff(102, 103, 101, [], [['100.1', '6']]), 1100)).toBe('applied');
    expect(book.lastUpdateId).toBe(103);
    expect(book.measure(0.1, 1200)?.askBase).toBe(6);
  });

  it('discards old events, rejects an unbridged snapshot and accepts a newer bridging snapshot', () => {
    const book = new BinanceDepthBook();
    book.beginSync();
    book.push(diff(90, 99, 89), 1000);
    expect(book.applySnapshot(snapshot, 1100)).toBe(false);
    expect(book.state).toBe('syncing');
    book.push(diff(100, 102, 99), 1200);
    expect(book.applySnapshot(snapshot, 1300)).toBe(true);
  });

  it('applies absolute size changes and removes zero-size levels', () => {
    const book = synchronizedBook();
    expect(book.push(diff(102, 103, 101, [['100', '7']], [['100.1', '0']]), 1100)).toBe('applied');
    expect(book.measure(0.6, 1200)).toMatchObject({ bidBase: 7, bidQuote: 700, askBase: 5, askQuote: 505 });
  });

  it('marks continuity gaps unavailable until a fresh snapshot bridges the new stream', () => {
    const book = synchronizedBook();
    expect(book.measure(0.1, 1000)).not.toBeNull();
    expect(book.push(diff(104, 105, 103), 1100)).toBe('gap');
    expect(book.state).toBe('syncing');
    expect(book.measure(0.1, 1200)).toBeNull();
    expect(book.applySnapshot({ ...snapshot, lastUpdateId: 104 }, 1300)).toBe(true);
    expect(book.measure(0.1, 1400)).not.toBeNull();
  });

  it('returns exact base and quote sums only where both snapshot boundaries cover the band', () => {
    const book = synchronizedBook();
    expect(book.measure(0.1, 1000)).toMatchObject({
      mid: 100.05, bidCovered: true, askCovered: true,
      bidBase: 2, bidQuote: 200, askBase: 4, askQuote: 400.4,
    });
    const wider = book.measure(11, 1100);
    expect(wider).toMatchObject({ bidCovered: false, askCovered: false, bidBase: null, askBase: null });
    expect(book.measure(0, 1100)).toBeNull();
  });

  it('keeps the original coverage boundary conservative as the mid moves', () => {
    const book = synchronizedBook();
    book.push(diff(102, 103, 101, [['100', '0'], ['99', '0'], ['95', '2']], [['100.1', '0'], ['95.1', '3']]), 1100);
    expect(book.measure(10, 1200)).toMatchObject({ bidCovered: false, askCovered: true, bidBase: null, askBase: 8 });
    expect(book.measure(0.01, 1300)?.bidCovered).toBe(true);
  });

  it('accepts the bounded 0.25% band but leaves it unavailable when the snapshot edge is too narrow', () => {
    const book = new BinanceDepthBook();
    const narrow: DepthSnapshot = {
      lastUpdateId: 100,
      bids: [['100', '2'], ['99.9', '3']],
      asks: [['100.1', '4'], ['100.2', '5']],
    };
    book.beginSync();
    book.push(diff(100, 101, 99), 900);
    expect(book.applySnapshot(narrow, 1000)).toBe(true);
    expect(book.measure(0.25, 1100)).toMatchObject({
      bandPercent: 0.25, bidCovered: false, askCovered: false,
      bidBase: null, bidQuote: null, askBase: null, askQuote: null,
    });
  });
});

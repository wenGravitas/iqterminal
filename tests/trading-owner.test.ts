import { describe, expect, it } from 'vitest';
import { SigningOwner } from '../src/trading/owner';

class FakeWebLocks {
  private held = false;
  rejectNext: Error | null = null;
  delayNext = false;

  async request(_name: string, _options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: { name: string } | null) => Promise<void>) {
    if (this.delayNext) {
      this.delayNext = false;
      await new Promise<void>(resolve => queueMicrotask(resolve));
    }
    if (this.rejectNext) {
      const error = this.rejectNext;
      this.rejectNext = null;
      throw error;
    }
    if (this.held) return callback(null);
    this.held = true;
    try { await callback({ name: 'fake-signing-lock' }); }
    finally { this.held = false; }
  }
}

function installPlatform(locks: FakeWebLocks | undefined) {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousBroadcast = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
  return () => {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    if (previousBroadcast) Object.defineProperty(globalThis, 'BroadcastChannel', previousBroadcast);
    else Reflect.deleteProperty(globalThis, 'BroadcastChannel');
  };
}

describe('Hyperliquid signing ownership', () => {
  it('allows only one tab to own signing and transfers ownership after Lock', async () => {
    const restore = installPlatform(new FakeWebLocks());
    const first = new SigningOwner(), second = new SigningOwner();
    try {
      expect(first.state.supported).toBe(true);
      const firstLease = await first.acquire();
      expect(firstLease).toMatchObject({ id: expect.any(Number) });
      expect(first.state.owned).toBe(true);
      expect(await second.acquire()).toBeNull();
      expect(second.state.owned).toBe(false);
      await first.release(firstLease!);
      expect(first.state.owned).toBe(false);
      const secondLease = await second.acquire();
      expect(secondLease).toMatchObject({ id: expect.any(Number) });
      expect(second.state.owned).toBe(true);
      await second.release(secondLease!);
    } finally {
      first.dispose(); second.dispose(); restore();
    }
  });

  it('keeps signing unavailable when Web Locks are unsupported', async () => {
    const restore = installPlatform(undefined);
    const owner = new SigningOwner();
    try {
      expect(owner.state.supported).toBe(false);
      await expect(owner.acquire()).rejects.toThrow('does not support Web Locks');
      expect(owner.state.owned).toBe(false);
    } finally { owner.dispose(); restore(); }
  });

  it('shares concurrent acquisition and only the active lease can release ownership', async () => {
    const restore = installPlatform(new FakeWebLocks());
    const owner = new SigningOwner();
    try {
      const [first, concurrent] = await Promise.all([owner.acquire(), owner.acquire()]);
      expect(first).not.toBeNull();
      expect(concurrent).toBe(first);
      expect(owner.state.owned).toBe(true);
      await owner.release(first!);
      const next = await owner.acquire();
      expect(next).not.toBeNull();
      await owner.release(first!);
      expect(owner.state.owned).toBe(true);
      await owner.release(next!);
      expect(owner.state.owned).toBe(false);
    } finally { owner.dispose(); restore(); }
  });

  it('cancels an acquisition requested before its Web Lock callback runs', async () => {
    const locks = new FakeWebLocks(); locks.delayNext = true;
    const restore = installPlatform(locks);
    const owner = new SigningOwner();
    try {
      const pending = owner.acquire();
      await owner.release();
      expect(await pending).toBeNull();
      expect(owner.state.owned).toBe(false);
    } finally { owner.dispose(); restore(); }
  });

  it('surfaces Web Locks request errors without an unhandled secondary rejection', async () => {
    const locks = new FakeWebLocks();
    const restore = installPlatform(locks);
    const owner = new SigningOwner();
    try {
      locks.rejectNext = new Error('web lock request failed');
      await expect(owner.acquire()).rejects.toThrow('web lock request failed');
      expect(owner.state.owned).toBe(false);
      // A later acquisition confirms the rejected request left the owner reusable.
      const lease = await owner.acquire();
      expect(lease).not.toBeNull();
      await owner.release(lease!);
    } finally { owner.dispose(); restore(); }
  });
});

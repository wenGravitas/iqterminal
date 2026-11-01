import { describe, expect, it } from 'vitest';
import { SigningOwner } from '../src/trading/owner';

class FakeWebLocks {
  private held = false;

  async request(_name: string, _options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: { name: string } | null) => Promise<void>) {
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
      expect(await first.acquire()).toBe(true);
      expect(first.state.owned).toBe(true);
      expect(await second.acquire()).toBe(false);
      expect(second.state.owned).toBe(false);
      await first.release();
      expect(first.state.owned).toBe(false);
      expect(await second.acquire()).toBe(true);
      expect(second.state.owned).toBe(true);
      await second.release();
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
});

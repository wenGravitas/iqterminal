const LOCK_NAME = 'basis.hyperliquid.signing-owner.v1';
const CHANNEL_NAME = 'basis.hyperliquid.signing-owner.v1';

type OwnerMessage = { type: 'query' } | { type: 'owner' | 'released'; id: string };

export class SigningOwner {
  readonly id = crypto.randomUUID();
  private channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
  private holdRelease: (() => void) | null = null;
  private request: Promise<void> | null = null;
  private owned = false;
  private otherOwner = false;
  private listeners = new Set<(owned: boolean, otherOwner: boolean) => void>();

  constructor() {
    if (!this.channel) return;
    this.channel.onmessage = event => {
      const message = event.data as OwnerMessage;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'query' && this.owned) this.channel?.postMessage({ type: 'owner', id: this.id } satisfies OwnerMessage);
      if (message.type === 'owner' && message.id !== this.id) this.otherOwner = true;
      if (message.type === 'released') this.otherOwner = false;
      this.publish();
    };
    this.channel.postMessage({ type: 'query' } satisfies OwnerMessage);
  }

  get state() { return { owned: this.owned, otherOwner: this.otherOwner, supported: typeof navigator !== 'undefined' && !!navigator.locks }; }
  subscribe(listener: (owned: boolean, otherOwner: boolean) => void) { this.listeners.add(listener); listener(this.owned, this.otherOwner); return () => this.listeners.delete(listener); }

  async acquire(): Promise<boolean> {
    if (this.owned) return true;
    if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('This browser does not support Web Locks; agent signing stays locked');
    let resolveAcquired!: (acquired: boolean) => void;
    const acquired = new Promise<boolean>(resolve => { resolveAcquired = resolve; });
    const held = new Promise<void>(resolve => { this.holdRelease = resolve; });
    this.request = navigator.locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { resolveAcquired(false); return; }
      this.owned = true; this.otherOwner = false; this.publish();
      this.channel?.postMessage({ type: 'owner', id: this.id } satisfies OwnerMessage);
      resolveAcquired(true);
      await held;
      this.owned = false; this.publish();
      this.channel?.postMessage({ type: 'released', id: this.id } satisfies OwnerMessage);
    }).catch(error => { resolveAcquired(false); throw error; });
    const result = await acquired;
    if (!result) this.holdRelease = null;
    return result;
  }

  async release() {
    if (!this.owned) return;
    this.holdRelease?.(); this.holdRelease = null;
    await this.request?.catch(() => {});
    this.request = null;
  }

  dispose() { void this.release(); this.channel?.close(); this.listeners.clear(); }
  private publish() { for (const listener of this.listeners) listener(this.owned, this.otherOwner); }
}

